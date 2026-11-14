# Phase 6: the API

What was done is of three kinds: a rule that was written in several places is written once, one option nothing set is gone, and one guard moved to the function every caller passes through. No route, answer, table or contract changed, and `apps/api/openapi.json` is as it was but for its version line. The API's files, its row mappers, its wiring and its slice boundaries stand as they were.

## One place for one rule

| What | Where it lives now | Done in |
|---|---|---|
| A route contract's pieces: the refusal's envelope, the JSON body, the bearer scheme, the 401 of a session, the staff's 401 and 403 | `lib/openapi.ts`, used by every route file but the health probe's (`health/index.ts`), which takes no session and refuses nothing | #660, #661; the last three staff routes in #673 |
| The wait a refusal names, answered as `Retry-After` | `onError` in `lib/errors.ts`, for every refusal that carries `retryAfterSeconds`; no route reads it any more. The chat's photo route and the upload still set five seconds for a busy pipeline, whose refusal names no wait | #674; the chat's photo route in #680 |
| The order of a send: the account held, the conversation locked, its state read (ADR-031 §3) | `lockForSend` in `chat/conversations.ts`, for a message, a contact and an unmatch (#660) and for a photo (#673) | #660, #673 |
| A photo the check did not see | `UNCHECKED` in `media/moderation.ts`, once | #660 |
| Writing a photo's three sizes, and dropping what no row holds | `putVariants` and its neighbours in `media/photos.ts`; the keys in `media/store.ts` | #660 |
| A day in milliseconds, and a date some days on | `DAY_MS` and `addDays` in `lib/finnish-day.ts` | #660, #661 |
| A round's new last place | `givePlaces` in `matching/rounds.ts` | #660 |
| A report's first steps: the reporter held, then an open report and the day's cap | `holdReporter` and `pairRefusal` in `safety/reports.ts` | #660 |
| The two guards' shared steps: the token's shape, the bearer read, the limiter and the touch | `lib/auth-middleware.ts`, which the staff's guard imports. They stay two guards over two tables | #660 |
| "Development or test" | `developmentOrTest` in `lib/config.ts` | #661 |
| The keys the logger blanks | `REDACTED_KEYS` in `lib/logger.ts`, from which both lists are built | #661 |

## Removed

- **The push sender's `project` option** (#673). It was there "unless a test says otherwise", and no caller ever set it. The sender compares against `EXPO_PROJECT`, as it always did.

## A guard at its source

- **Whether somebody is shown to others** (#675). `fittingNow` in `jobs/round-builder.ts`, which answers who fits a person now, also asks whether each of them is shown to anybody. The Starred list had its own filter for that, which is gone. No route's answer changed: inside, `fitsNow` now leaves such a person out itself, where the queue's reads left their card out one step later, at the card builder. A shadow-banned person's own queue goes on as before (ADR-024 §7).
- **The wait is a whole number** (#674). `retryAfterOf` takes only a whole number of seconds above zero for a wait, since the error handler answers it as a header.
