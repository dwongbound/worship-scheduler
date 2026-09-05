// The one timezone this app reasons in.
//
// Recurring set times and busy blocks are stored as a weekday plus minutes
// from midnight — "Friday, 7:00 PM" — which only means something against a
// SPECIFIC zone: the church's. The server has always had it (instrumentation.ts
// pins process.env.TZ from APP_TZ at startup), but the browser used its own,
// so an admin in another zone saw a Friday-evening set land on Saturday
// morning — and, worse, availability checks run there disagreed with the
// scheduler's about which day and hour the set was on.
//
// So the value has to reach the client too, which means NEXT_PUBLIC_ (inlined
// at build time). Unset, everything falls back to the same default
// instrumentation.ts uses, so behaviour is unchanged for anyone not setting it.
export const APP_TZ =
  // Client bundles only ever see the NEXT_PUBLIC_ one; the bare APP_TZ is for
  // server code, where instrumentation.ts has already applied it to TZ anyway.
  process.env.NEXT_PUBLIC_APP_TZ ||
  process.env.APP_TZ ||
  "America/Los_Angeles";
