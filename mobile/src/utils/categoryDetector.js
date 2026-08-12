// Auto-detect a spending category from a bank transaction description.
// Ported from akashdas765/personal-expense-manager — keyword lists kept
// as-is; Tailwind class strings dropped since this app styles by inline
// hex color (see memberColor.js) rather than category-specific classes.

export const CATEGORIES = {
  'Food & Dining': {
    color: '#f97316',
    icon: '🍽️',
    keywords: ['restaurant','food','pizza','burger','cafe','coffee','starbucks','dunkin',
      'mcdonald','chipotle','subway','domino','doordash','grubhub','ubereats','sushi',
      'taco','diner','grill','kitchen','eat','dining','wendy','chick-fil','panera',
      'panda','five guys','shake shack','cheesecake','olive garden','applebee'],
  },
  'Groceries': {
    color: '#10b981',
    icon: '🛒',
    keywords: ['grocery','supermarket','walmart','target','kroger','whole foods',
      'trader joe','safeway','costco','aldi','publix','market','wegmans','h-e-b',
      'meijer','stop & shop','food lion','giant','sprouts'],
  },
  'Transportation': {
    color: '#3b82f6',
    icon: '🚗',
    keywords: ['uber','lyft','taxi','gas','fuel','parking','transit','metro','bus',
      'train','amtrak','greyhound','bp','shell','chevron','exxon','marathon',
      'speedway','circle k','caseys'],
  },
  'Travel': {
    color: '#8b5cf6',
    icon: '✈️',
    keywords: ['hotel','airbnb','booking','expedia','vacation','resort','hostel',
      'airline','delta','united','american airlines','southwest','spirit','jetblue',
      'marriott','hilton','hyatt','ihg','hampton inn','holiday inn'],
  },
  'Shopping': {
    color: '#ec4899',
    icon: '🛍️',
    keywords: ['amazon','shop','mall','retail','clothing','apparel','nike','adidas',
      'zara','h&m','best buy','apple store','ikea','home depot','lowes','bed bath',
      'nordstrom','macys','gap','old navy','forever 21','tj maxx','marshalls'],
  },
  'Entertainment': {
    color: '#a855f7',
    icon: '🎬',
    keywords: ['netflix','spotify','hulu','disney','movie','cinema','theater',
      'concert','game','gaming','steam','playstation','xbox','twitch','youtube',
      'apple music','amazon prime','hbo','paramount','peacock'],
  },
  'Bills & Utilities': {
    color: '#eab308',
    icon: '💡',
    keywords: ['electric','water','gas bill','internet','phone','mobile','at&t',
      'verizon','t-mobile','comcast','xfinity','spectrum','cox','frontier',
      'utility','pge','con ed','duke energy','subscription'],
  },
  'Healthcare': {
    color: '#14b8a6',
    icon: '🏥',
    keywords: ['pharmacy','cvs','walgreens','rite aid','doctor','hospital',
      'medical','health','dental','vision','insurance','lab','clinic','urgent care'],
  },
  'Rent & Housing': {
    color: '#6366f1',
    icon: '🏠',
    keywords: ['rent','mortgage','lease','apartment','housing','hoa','property'],
  },
  'Education': {
    color: '#0ea5e9',
    icon: '📚',
    keywords: ['tuition','university','college','course','udemy','coursera','books',
      'textbook','school','education','learning','training'],
  },
  'Personal Care': {
    color: '#f43f5e',
    icon: '💆',
    keywords: ['salon','haircut','spa','massage','beauty','barber','nail',
      'skincare','ulta','sephora','bath & body'],
  },
  'Other': {
    color: '#94a3b8',
    icon: '📦',
    keywords: [],
  },
};

export function detectCategory(description) {
  if (!description) return 'Other';
  const lower = description.toLowerCase();
  for (const [cat, { keywords }] of Object.entries(CATEGORIES)) {
    if (cat === 'Other') continue;
    if (keywords.some(kw => lower.includes(kw))) return cat;
  }
  return 'Other';
}

export function getCategoryColor(cat) {
  return CATEGORIES[cat]?.color ?? CATEGORIES.Other.color;
}

export function getCategoryIcon(cat) {
  return CATEGORIES[cat]?.icon ?? '📦';
}

export const ALL_CATEGORIES = Object.keys(CATEGORIES);

// Colorblind-safe categorical palette for a chart that shows several
// categories side by side (e.g. Insights' category donut) — distinct from
// getCategoryColor above, which picks each category's color independently
// to match its own icon/vibe and isn't guaranteed distinguishable as a
// set (checked via the dataviz skill's validate_palette.js: several pairs,
// e.g. Travel's violet #8b5cf6 vs Transportation's blue #3b82f6, fall
// below the normal-vision floor when shown together — an unreadable pair
// even for full-color vision, not just a colorblind edge case). These 8
// hues are the skill's own reference categorical theme, pre-validated
// adjacent-pair-safe in both light and dark (see references/palette.md).
// Fixed order, never cycled — only the first 8 of ALL_CATEGORIES (by their
// declared order above) get an individually validated slot; any category
// past that, or past a chart's own display cap, falls back to the same
// neutral gray as CHART_OTHER_COLOR rather than reusing or generating a
// hue for it.
const CHART_HUES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
export const CHART_OTHER_COLOR = '#94a3b8';
const categoryChartColors = {};
ALL_CATEGORIES.filter(c => c !== 'Other').forEach((cat, i) => {
  if (i < CHART_HUES.length) categoryChartColors[cat] = CHART_HUES[i];
});

export function getCategoryChartColor(cat) {
  return categoryChartColors[cat] || CHART_OTHER_COLOR;
}

// Receipt line items use a small closed set of categories (see groq.js's
// PARSE_SYSTEM prompt: food/drink/alcohol/tip/fee/other) — a different,
// narrower vocabulary than the bank-transaction categories above. This maps
// one onto the other so Insights can combine receipt-item spend and
// bank-transaction spend into one category breakdown instead of showing
// "food" and "Food & Dining" as separate rows for the same thing.
const RECEIPT_CATEGORY_MAP = {
  food:    'Food & Dining',
  drink:   'Food & Dining',
  alcohol: 'Food & Dining',
  tip:     'Food & Dining',
  fee:     'Other',
  other:   'Other',
};

export function mapReceiptCategory(cat) {
  return RECEIPT_CATEGORY_MAP[(cat || '').toLowerCase()] || 'Other';
}
