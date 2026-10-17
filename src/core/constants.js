// Real-world units: metres and seconds. x = right, y = up, z = toward
// the penalty taker. The goal line is z = 0, the spot is z = 11.
export const HALF = 3.66, GOAL_H = 2.44, POST_R = 0.06, R = 0.11;
export const PX = HALF + POST_R, BAR_Y = GOAL_H + POST_R;
export const SPOT_Z = 11, G = -9.81, MAGNUS = 0.022;
export const NET_D0 = 2.0, NET_D1 = 1.0;          // net depth at the ground / at the roof
export const KEEPER_Z = 0.35;
export const REACH = 2.09;                          // feet to gloves with arms up

// The taker's run-up lasts RUNUP seconds. At COMMIT seconds the plant foot
// lands: before it the taker can still change side, after it the shot is locked.
export const RUNUP = 1.05;
export const COMMIT = 0.72;

export const netDepth = (y) => NET_D0 - (NET_D0 - NET_D1) * (y / GOAL_H);
