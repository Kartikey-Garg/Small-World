// Node-side loader: requires every mod in order. The browser loads the same list via <script> tags in index.html.
// Order matters: later mods may depend on state created by earlier ones.
[
  'skills',
  'mood',
  'family',
  'relations',
  'tools',
  'jobs',
  'market',
  'wells',
  'soil',
  'fire',
  'disasters',
  'injury',
  'governance',
  'defense',
  'crime',
  'god',
  'history',
  'personality',
  'goals',
  'eras',
  'civilization',
  'recorder',
  // ai_leader is browser-only — it guards itself with typeof window check
  // 'ai_leader',
].forEach(m => require('./' + m + '.js'));
