// Opponent playing styles. Skill (how fast and accurate) comes from the
// difficulty level or cup rating; style is *what they tend to do*, so you
// can adapt instead of just facing faster reactions.
//
// Directions are world x. When you keep goal you face the taker, so world
// -x is your right hand and the right of your screen.
//
// taker.side     -1..1  lean toward -x (your right as keeper) or +x
// taker.high     0..1   share of shots aimed at the top half
// taker.low      0..1   share of shots aimed along the ground
// taker.middle   0..1   share of chips / drives down the middle
// taker.power    -0.2..0.2 faster (+) or slower (-) shots
// taker.switch   multiplier on the chance to change side after an early dive
// keeper.gamble  multiplier on the chance to guess a side at the strike
// keeper.readSpin 0..1  understands curl (overrides a lower level value)
// keeper.lowSafe / highWeak  extra accuracy on low shots / error on high ones
// keeper.react   seconds added to the reaction time
export const STYLES = {
  balanced: {
    label: 'Balanced',
    scout: 'No obvious habits. Mix up your corners.',
    taker: {}, keeper: {},
  },
  guesser: {
    label: 'Guesser',
    scout: 'Their keeper guesses a side as you strike. A firm shot down the middle beats them.',
    taker: {}, keeper: { gamble: 2.6 },
  },
  powerLow: {
    label: 'Low drivers',
    scout: 'Their takers drive it low and hard. Keep your dives low.',
    taker: { low: 0.75, high: 0.1, power: 0.12 }, keeper: {},
  },
  rightFooted: {
    label: 'Right-footed',
    scout: 'Their takers favour your right. Lean that way, but wait for the gold bar.',
    taker: { side: -0.8 }, keeper: {},
  },
  wall: {
    label: 'The Wall',
    scout: 'Their keeper never guesses and smothers low shots. Lift it toward the corners.',
    taker: {}, keeper: { gamble: 0, lowSafe: 0.6, highWeak: 0.45 },
  },
  highFlyer: {
    label: 'High flyers',
    scout: 'Their takers aim for the top corners and sometimes blaze it over. Dive high.',
    taker: { high: 0.8, low: 0.05, over: 0.12 }, keeper: {},
  },
  trickster: {
    label: 'Tricksters',
    scout: 'They punish early dives and love a chip down the middle. Wait for the gold bar.',
    taker: { switch: 1.9, middle: 0.3 }, keeper: {},
  },
  reader: {
    label: 'The Reader',
    scout: 'Their keeper waits and reads curl and placement. Beat them with pace.',
    taker: {}, keeper: { readSpin: 1, accuracy: 0.6, react: 0.07, gamble: 0.3 },
  },
};

export const STYLE_KEYS = Object.keys(STYLES);

export const styleOf = (key) => STYLES[key] || STYLES.balanced;
