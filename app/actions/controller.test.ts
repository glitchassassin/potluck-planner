import * as assert from "node:assert/strict";
import { createAction } from "remix/router";
import { get } from "remix/routes";
import { describe, it } from "remix/test";

import { createTwilioVerifyMock } from "../../dev/twilio-verify-mock.ts";
import { createAccount, findAccountByPhone } from "../auth/accounts.ts";
import { requireAccount, safeReturnPath } from "../auth/route-guard.ts";
import { createSessions } from "../auth/sessions.ts";
import { migrateDatabase, openDatabase } from "../db.ts";
import { createAppRouter } from "../router.ts";

const phone = "+1 212-555-0142";
const day = 24 * 60 * 60_000;

async function fixture() {
  const db = openDatabase(":memory:");
  await migrateDatabase(db);
  let timestamp = Date.now();
  const now = () => timestamp;
  const mock = createTwilioVerifyMock(now);
  const sent: string[] = [];
  const router = await createAppRouter({
    db,
    verifyClient: {
      send(number) {
        sent.push(number);
        return mock.send(number);
      },
      check: mock.check,
    },
    now,
  });

  function browser() {
    const cookies = new Map<string, string>();
    return {
      cookieHeader: () => [...cookies.values()].join("; "),
      async request(path: string, fields?: Record<string, string>, headers?: HeadersInit) {
        const requestHeaders = new Headers(headers);
        if (!requestHeaders.has("Cookie")) {
          requestHeaders.set("Cookie", [...cookies.values()].join("; "));
        }
        const response = await router.fetch(
          new Request(new URL(path, "https://potluck.test"), {
            method: fields ? "POST" : "GET",
            body: fields ? new URLSearchParams(fields) : undefined,
            headers: requestHeaders,
          }),
        );
        for (const cookie of response.headers.getSetCookie()) {
          const pair = cookie.split(";", 1)[0];
          const name = pair.split("=", 1)[0];
          if (/Max-Age=0\b/i.test(cookie)) cookies.delete(name);
          else cookies.set(name, pair);
        }
        return response;
      },
    };
  }

  return {
    db,
    browser,
    now,
    router,
    sent,
    advance: (ms: number) => (timestamp += ms),
    [Symbol.asyncDispose]: () => db.close(),
  };
}

function location(response: Response) {
  assert.equal(response.status, 303);
  return response.headers.get("Location");
}

describe("sign-in controller", () => {
  it("normalizes the SMS number and requires one verified name submission", async () => {
    await using app = await fixture();
    const browser = app.browser();

    assert.equal(location(await browser.request("/")), "/sign-in");
    assert.match(await (await browser.request("/sign-in")).text(), /Sign in or sign up/);
    assert.equal(location(await browser.request("/sign-in/name", { name: "Alex" })), "/sign-in");

    const invalid = await browser.request("/sign-in", { phone: "+1 416-555-0142" });
    assert.equal(invalid.status, 400);
    assert.match(await invalid.text(), /Enter a supported phone number/);
    assert.deepEqual(app.sent, []);

    assert.equal(location(await browser.request("/sign-in", { phone })), "/sign-in/code");
    assert.deepEqual(app.sent, ["+12125550142"]);
    assert.match(await (await browser.request("/sign-in/code")).text(), /\(212\) 555-0142/);
    assert.equal(location(await browser.request("/sign-in/name", { name: "Alex" })), "/sign-in");

    const wrong = await browser.request("/sign-in/code", { code: "111111" });
    assert.equal(wrong.status, 400);
    assert.match(await wrong.text(), /code is incorrect/);
    const beforeVerification = browser.cookieHeader();
    assert.equal(
      location(await browser.request("/sign-in/code", { code: "000000" })),
      "/sign-in/name",
    );
    assert.notEqual(browser.cookieHeader(), beforeVerification);
    assert.equal(await findAccountByPhone(app.db, phone), null);
    assert.equal(location(await browser.request("/")), "/sign-in");

    const signupCookie = browser.cookieHeader();
    const valid = await browser.request("/sign-in/name", { name: "  Alex  " });
    assert.equal(location(valid), "/");
    const sessionCookie = valid.headers
      .getSetCookie()
      .find((cookie) => /potluck_session=/.test(cookie));
    assert.match(sessionCookie ?? "", /Max-Age=2592000/i);
    assert.match(sessionCookie ?? "", /HttpOnly/i);

    const home = await browser.request("/");
    assert.equal(home.status, 200);
    assert.equal(home.headers.get("Cache-Control"), "no-store");
    assert.match(await home.text(), /Welcome, Alex/);
    assert.equal((await findAccountByPhone(app.db, phone))?.name, "Alex");
    const replay = await app
      .browser()
      .request("/sign-in/name", { name: "Other name" }, { Cookie: signupCookie });
    assert.equal(location(replay), "/sign-in");
    assert.equal(replay.headers.getSetCookie().length, 0);
  });

  it("evaluates access at a protected destination after name entry", async () => {
    await using app = await fixture();
    const destination = "/events/supper?invite=one%2Btwo&from=sms&from=link";
    const route = get("/events/supper");
    let invitationValid = true;
    app.router.map(
      route,
      createAction(route, {
        middleware: [requireAccount(createSessions(app.db, { now: app.now }))],
        handler(context) {
          assert.equal(context.url.pathname + context.url.search, destination);
          assert.equal(context.account.name, "Alex");
          return new Response(invitationValid ? "Allowed" : "Invitation expired", {
            status: invitationValid ? 200 : 403,
          });
        },
      }),
    );
    const browser = app.browser();

    const signIn = location(await browser.request(destination));
    assert.ok(signIn);
    const returnTo = new URL(signIn, "https://potluck.test").searchParams.get("returnTo");
    assert.equal(returnTo, destination);
    assert.equal(location(await browser.request("/sign-in", { phone, returnTo })), "/sign-in/code");
    assert.equal(
      location(await browser.request("/sign-in/code", { code: "000000" })),
      "/sign-in/name",
    );

    invitationValid = false;
    assert.equal(location(await browser.request("/sign-in/name", { name: "Alex" })), destination);
    const denied = await browser.request(destination);
    assert.equal(denied.status, 403);
    assert.equal(await denied.text(), "Invitation expired");
  });

  it("signs into the existing account and revokes only the current session", async () => {
    await using app = await fixture();
    const account = await createAccount(app.db, { verifiedPhoneNumber: phone, name: "Alex" });
    assert.ok(account);
    const first = app.browser();
    const second = app.browser();

    for (const browser of [first, second]) {
      assert.equal(location(await browser.request("/sign-in", { phone })), "/sign-in/code");
      assert.equal(location(await browser.request("/sign-in/code", { code: "000000" })), "/");
      app.advance(60_000);
    }
    assert.deepEqual(await findAccountByPhone(app.db, phone), account);
    const oldCookie = first.cookieHeader();

    const crossOrigin = await first.request("/logout", {}, { Origin: "https://other.test" });
    assert.equal(crossOrigin.status, 403);
    assert.equal((await first.request("/")).status, 200);
    assert.equal(location(await first.request("/logout", {})), "/sign-in");
    assert.equal(location(await first.request("/", undefined, { Cookie: oldCookie })), "/sign-in");

    app.advance(30 * day - 60_001);
    assert.equal((await second.request("/")).status, 200);
    app.advance(1);
    assert.equal(location(await second.request("/")), "/sign-in");
  });

  it("discards external return URLs supplied with the phone form", async () => {
    await using app = await fixture();
    await createAccount(app.db, { verifiedPhoneNumber: phone, name: "Alex" });
    const browser = app.browser();

    assert.equal(
      location(await browser.request("/sign-in", { phone, returnTo: "https://other.test/event" })),
      "/sign-in/code",
    );
    assert.equal(location(await browser.request("/sign-in/code", { code: "000000" })), "/");
    for (const path of ["//other.test", "/\\other.test", "/x/..//other.test", "/\t/other.test"]) {
      assert.equal(safeReturnPath(path), "/");
    }
  });
});
