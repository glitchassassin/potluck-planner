import * as assert from "node:assert/strict";
import { createAction } from "remix/router";
import { get } from "remix/routes";
import { describe, it } from "remix/test";

import { createTwilioVerifyMock } from "../../dev/twilio-verify-mock.ts";
import { createAccount, findAccountByPhone, setHostGrant } from "../auth/accounts.ts";
import { requireAccount, safeReturnPath } from "../auth/route-guard.ts";
import { createSessions } from "../auth/sessions.ts";
import { migrateDatabase, openDatabase } from "../db.ts";
import { clientIps } from "../observability/client-ip.ts";
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

  function browser(ip = "192.0.2.1") {
    const cookies = new Map<string, string>();
    return {
      cookieHeader: () => [...cookies.values()].join("; "),
      async request(path: string, fields?: Record<string, string>, headers?: HeadersInit) {
        const requestHeaders = new Headers(headers);
        if (!requestHeaders.has("Cookie")) {
          requestHeaders.set("Cookie", [...cookies.values()].join("; "));
        }
        const request = new Request(new URL(path, "https://potluck.test"), {
          method: fields ? "POST" : "GET",
          body: fields ? new URLSearchParams(fields) : undefined,
          headers: requestHeaders,
        });
        clientIps.set(request, ip);
        const response = await router.fetch(request);
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
    const start = await browser.request("/sign-in", { phone, returnTo });
    assert.equal(location(start), "/sign-in/code");
    const returnCookie =
      start.headers.getSetCookie().find((cookie) => cookie.includes("potluck_return_to=")) ?? "";
    assert.match(returnCookie, /Max-Age=1200\b/i);
    assert.match(returnCookie, /HttpOnly/i);
    assert.equal(
      location(await browser.request("/sign-in/code", { code: "000000" })),
      "/sign-in/name",
    );

    invitationValid = false;
    const signup = await browser.request("/sign-in/name", { name: "Alex" });
    assert.equal(location(signup), destination);
    assert.match(
      signup.headers.getSetCookie().find((cookie) => cookie.includes("potluck_return_to=")) ?? "",
      /Max-Age=0\b/i,
    );
    assert.doesNotMatch(browser.cookieHeader(), /potluck_return_to=/);
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

    for (const [browser, returnTo] of [
      [first, "/?from=returning"],
      [second, "/"],
    ] as const) {
      assert.equal(
        location(await browser.request("/sign-in", { phone, returnTo })),
        "/sign-in/code",
      );
      assert.equal(location(await browser.request("/sign-in/code", { code: "000000" })), returnTo);
      assert.doesNotMatch(browser.cookieHeader(), /potluck_return_to=/);
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

  it("uses current Host and Admin permissions on every request in the same session", async () => {
    await using app = await fixture();
    const account = await createAccount(app.db, { verifiedPhoneNumber: phone, name: "Alex" });
    assert.ok(account);
    app.router.get("/account-permissions", {
      middleware: [requireAccount(createSessions(app.db, { now: app.now }))],
      handler({ account }) {
        return Response.json(account.permissions);
      },
    });

    const browser = app.browser();
    assert.equal(location(await browser.request("/sign-in", { phone })), "/sign-in/code");
    assert.equal(location(await browser.request("/sign-in/code", { code: "000000" })), "/");
    const sessionCookie = browser.cookieHeader();
    async function readPermissions() {
      const response = await browser.request("/account-permissions");
      assert.equal(response.status, 200);
      assert.equal(browser.cookieHeader(), sessionCookie);
      return response.json();
    }

    const previous = process.env.ADMIN_PHONE_ALLOWLIST;
    try {
      const user = { isHost: false, isAdmin: false, canCreateEvents: false };
      const host = { isHost: true, isAdmin: false, canCreateEvents: true };
      const admin = { isHost: false, isAdmin: true, canCreateEvents: true };
      process.env.ADMIN_PHONE_ALLOWLIST = "";
      assert.deepEqual(await readPermissions(), user);
      await setHostGrant(app.db, account.id, true);
      assert.deepEqual(await readPermissions(), host);
      await setHostGrant(app.db, account.id, false);
      assert.deepEqual(await readPermissions(), user);

      process.env.ADMIN_PHONE_ALLOWLIST = phone;
      assert.deepEqual(await readPermissions(), admin);
      await setHostGrant(app.db, account.id, true);
      assert.deepEqual(await readPermissions(), { ...admin, isHost: true });
      await setHostGrant(app.db, account.id, false);
      assert.deepEqual(await readPermissions(), admin);
    } finally {
      if (previous === undefined) delete process.env.ADMIN_PHONE_ALLOWLIST;
      else process.env.ADMIN_PHONE_ALLOWLIST = previous;
    }
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

  it("revalidates the return cookie before redirecting a returning user", async () => {
    await using app = await fixture();
    await createAccount(app.db, { verifiedPhoneNumber: phone, name: "Alex" });
    const browser = app.browser();
    const start = await browser.request("/sign-in", { phone, returnTo: "/?from=invitation" });
    assert.equal(location(start), "/sign-in/code");
    const forged = Buffer.from("//other.test").toString("base64url");
    const cookie = browser
      .cookieHeader()
      .replace(/potluck_return_to=[^;]+/, `potluck_return_to=${forged}`);

    assert.notEqual(cookie, browser.cookieHeader());
    const login = await browser.request("/sign-in/code", { code: "000000" }, { Cookie: cookie });
    assert.equal(location(login), "/");
    assert.doesNotMatch(browser.cookieHeader(), /potluck_return_to=/);
  });

  it("shares the per-IP send quota across phones, browsers, and resend", async () => {
    await using app = await fixture();
    const browser = app.browser();
    const anotherBrowser = app.browser();
    const otherNetwork = app.browser("192.0.2.2");
    for (let number = 150; number < 160; number++) {
      const response = await browser.request("/sign-in", { phone: `212-555-0${number}` });
      assert.equal(location(response), "/sign-in/code");
    }

    const blocked = await anotherBrowser.request("/sign-in", { phone });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get("Retry-After"), "600");
    assert.match(await blocked.text(), /Too many code requests from your network/);
    assert.equal((await browser.request("/sign-in/resend", {})).status, 429);
    assert.equal(app.sent.length, 10);
    assert.equal(location(await otherNetwork.request("/sign-in", { phone })), "/sign-in/code");
    assert.equal(
      location(await browser.request("/sign-in/code", { code: "000000" })),
      "/sign-in/name",
    );

    app.advance(599_999);
    assert.equal((await anotherBrowser.request("/sign-in", { phone })).status, 429);
    app.advance(1);
    assert.equal(location(await anotherBrowser.request("/sign-in", { phone })), "/sign-in/code");
  });

  it("limits code checks per IP before verifying a correct code", async () => {
    await using app = await fixture();
    const browser = app.browser();
    const otherNetwork = app.browser("192.0.2.2");
    assert.equal(location(await browser.request("/sign-in", { phone })), "/sign-in/code");
    for (let attempt = 0; attempt < 30; attempt++) {
      assert.equal((await browser.request("/sign-in/code", { code: "invalid" })).status, 400);
    }

    const blocked = await browser.request("/sign-in/code", { code: "000000" });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get("Retry-After"), "600");
    assert.match(await blocked.text(), /Too many verification attempts from your network/);
    const checked = await otherNetwork.request(
      "/sign-in/code",
      { code: "000000" },
      { Cookie: browser.cookieHeader() },
    );
    assert.equal(location(checked), "/sign-in/name");
  });
});
