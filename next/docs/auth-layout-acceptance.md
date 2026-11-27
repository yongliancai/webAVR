# Login layout acceptance

Version 0.9.3 fixes the authentication pages without changing teaching content or the authentication API. Google sign-in uses a full-width block action with its own divider; email password recovery stays beside the password label. Backup password setup and first-time activation are separate, readable actions. Tablets use a single-column form; shorter desktop windows hide decorative art.

Chrome acceptance covered 1440x900, 1280x800, 1024x768, 768x1024, 834x1194, 1194x834, 390x844 and 320x800 CSS-pixel viewports. Controls did not overlap or cause page-wide horizontal scrolling, the Google divider gap was 16px, and the visible controls were at least 48px tall. Actual Chrome zoom was also tested at 125%, 150%, 175% and 200%, then restored to 100%. These are browser tests, not physical-tablet certification.

The activation and recovery screens, request feedback, the placeholder reset form, keyboard focus, unavailable sign-in options and retry recovery were checked. A synthetic learner signed in through email and reached the exploration classroom. The approved teacher completed Google sign-in and returned to the same account. No real password was captured or changed by the agent. Full existing tests and build passed.

Styles are scoped to the authentication area. Existing teaching thumbnails, panorama controls and the recognition-point-to-function-icon interaction remain outside this change. Data and media preservation are deployment gates.
