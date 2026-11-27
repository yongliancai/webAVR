# Email backup login and password recovery

Google remains the primary sign-in option. Approved Google users can choose “Google 帳號設定 email 備用密碼” to receive a link and set a webAVR password. “忘記密碼” uses the same recovery process. Passwords must contain 15–128 characters.

Links expire after 30 minutes and can be used once. Setting or resetting a password requires signing in again and invalidates that account’s existing sessions in the same environment. Acceptance and production passwords are independent; testing does not copy credentials or learning data between environments.

Acceptance verified actual email receipt, initial password setup and email sign-in, followed by another recovery email, password reset and sign-in. Account audit records confirmed both successful resets and logins. The six original teaching drafts remained accessible. Protected material and learning-history table digests matched the pre-test baseline.

Automated checks cover encrypted mail transport, sanitized connection errors, queued retries, restricted recipients (including jobs queued before a configuration change), failed-token cleanup, one-use links and session invalidation. No email credential or private learner data is included in this repository.
