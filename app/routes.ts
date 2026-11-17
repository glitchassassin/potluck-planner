import { form, get, post, route } from "remix/routes";

export const routes = route({
  assets: get("/assets/*path"),
  home: get("/"),
  signIn: {
    phone: form("/sign-in"),
    code: form("/sign-in/code"),
    resend: post("/sign-in/resend"),
    name: form("/sign-in/name"),
    logout: post("/logout"),
  },
});
