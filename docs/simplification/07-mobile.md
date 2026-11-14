# Phase 7: the phone app

One thing was done, a defect (#676, `4b886666`). No shared read or send hook was built, no screen was rebuilt, and the app's reads stand as each screen wrote them.

- **The onboarding's late read.** `useOnboarding` reads the status when its screen gets the focus and again after every step, and showed whichever read answered last. An earlier read that answered after a later one could put a newcomer back on a step already done, or, if it failed, onto the could-not-load screen. A read now counts itself and only the latest sets the state, as `pond/useGate.ts` and seven other reads of the app already did. The screen's two holds, on the photos and on whom the person seeks, are as they were: they hold a step against the newest answer, on purpose.
