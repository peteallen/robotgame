// Every tap-the-robot surprise lives here. Each action takes control of the
// robot, does something delightful, then hands control back.
//
// How to add a new action: create the object (a plain object with any of
// {name, weight, canRun, maxDur, start, update, end, onTap, drawUnder,
// drawOver}), drop it into the themed file it best fits — celebrations,
// stunts, chores, dockTrips, or trapped — then import it here and add a
// reg.register(...) line below. Give it a weight and canRun for the random
// picker; use weight 0 + canRun: () => false for actions only the Game forces.
import { SpinDance, HappyBeeps, BounceParty, Fireworks, WinParty } from './celebrations.js';
import { TurboZoom, RainbowTrail, BubbleParty, DiscoMode, HoverMode, UnderCouch, Sneeze, DogRide } from './stunts.js';
import { SockGrab, TidyToy } from './chores.js';
import { ModeSwitch, WashTrip, MopMode } from './dockTrips.js';
import { Trapped } from './trapped.js';

export function registerDefaultActions(reg) {
  reg.register(SpinDance);
  reg.register(TurboZoom);
  reg.register(RainbowTrail);
  reg.register(BubbleParty);
  reg.register(DiscoMode);
  reg.register(SockGrab);
  reg.register(TidyToy);
  reg.register(DogRide);
  reg.register(HappyBeeps);
  reg.register(Fireworks);
  reg.register(Sneeze);
  reg.register(BounceParty);
  reg.register(HoverMode);
  reg.register(UnderCouch);
  reg.register(MopMode);
  reg.register(ModeSwitch);
  reg.register(WashTrip);
  reg.register(Trapped);
  reg.register(WinParty);
}
