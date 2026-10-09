/** Invented words for the demo floor: a snack-delivery startup's backlog. No real product or person. */

export const DEMO_PROJECTS = [
  { name: 'Checkout', repos: ['snackbox-web', 'snackbox-api', 'coupon-engine'] },
  { name: 'Snack Radar', repos: ['radar-service', 'radar-maps', 'fridge-sensors'] },
  { name: 'Mobile App', repos: ['snackbox-ios', 'snackbox-android', 'push-gateway'] },
  { name: 'Billing', repos: ['billing-core', 'invoice-pdf', 'refund-bot'] },
  { name: 'Platform', repos: ['infra', 'ci-pipelines', 'feature-flags'] },
] as const

export const DEMO_ISSUES = [
  'Stop charging customers twice for one croissant',
  'Snack Radar thinks the office fridge is in Belgium',
  'Dark mode turns the logo into a black hole',
  "Rename 'cookie consent' so people stop expecting cookies",
  'Retry a failed payment without retrying the whole lunch',
  "Searching for 'kale' returns only donuts",
  "Push notification at 3am says 'snack time'",
  'Move the coupon engine off the shared spreadsheet',
  'The loading spinner spins anticlockwise',
  'Inventory goes negative whenever Dave visits',
  'Allergen badges hide behind the Add to cart button',
  "Rate-limit the 'I'm hungry' button",
  "Delivery ETA has said 'soon' for 41 minutes",
  'Remove the pizza icon from legal invoices',
  'Checkout test only passes on Tuesdays',
  'Pagination skips every page with a muffin on it',
  'Date picker still thinks it is 2019',
  "Ask 'are you sure?' before ordering 400 bagels",
  'Cache invalidation (the hard one)',
  'Receipt PDF prints in a playful font',
  'Snack Radar drains the battery: it never stops looking',
  'Split the 3,000-line OrderService into fewer lines',
  'Refunds work, but only for refunds',
  'Onboarding tour points at buttons that moved',
  'Make the 404 page less judgemental',
  'Breakfast deals start at midnight',
  'Leaderboard ranks people by crumbs left behind',
  'Webhook retries flood our own Slack',
  'The cart icon has no accessible name',
  "Delete the 2021 TODO that says 'temporary'",
] as const

export const DEMO_CAUSES = [
  'a retry loop that never heard of idempotency',
  'a timezone set to the developer’s holiday',
  'an off-by-one in the snack counter',
  'a feature flag nobody remembers turning on',
  'a regex written at 2am',
  'a cache that outlived three deploys',
  'a float pretending to be money',
  'a test fixture with a sense of humour',
] as const

export const DEMO_FIXES = [
  'one guard clause and a lot of tests',
  'deleting more code than it adds',
  'a migration and a strongly worded comment',
  'retrying once, politely',
  'moving the check before the charge',
  'a lookup table instead of vibes',
] as const

export const DEMO_SESSIONS = [
  'Read the code, then read it again, slower',
  'Bisect 214 commits to find the one',
  'Argue with the linter (and lose)',
  'Write the test that should already exist',
  'Rename every variable called x',
  'Reproduce it locally on the third try',
  'Delete more code than it adds',
  'Untangle the retry loop',
  'Convince CI it is not flaky',
  'Find out who wrote this (it was us)',
  'Add logging, then more logging',
  'Turn it off and on again, properly',
  'Draw the state machine on a napkin',
  'Ask the database what it has been doing',
  'Pin the dependency that moved',
  'Make the error message say what happened',
  'Chase a null through four services',
  'Port the spreadsheet formula to real code',
  'Shrink the PR so someone will review it',
  'Fix the typo that broke production',
] as const

export const DEMO_PARTS = [
  'Reproduce it with a test',
  'Find the root cause',
  'Write the fix',
  'Update the docs nobody reads',
  'Ship it behind a flag',
] as const

export const DEMO_PLAN_STEPS = [
  'Write a failing test',
  'Trace the call path',
  'Patch the handler',
  'Run the whole suite twice',
  'Open the PR',
] as const
