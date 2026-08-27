import { supabase } from './supabase'
import { toRateMap, type GameRate, type RateMap } from './gameBilling'

// One place that loads the price list for server code.
//
// Every route that prices something needs the same map, and each of them
// reaching for game_rates by hand is how two of them end up disagreeing about
// what happens when the table is unreachable. toRateMap already falls back to
// the printed-slip seed, so a failed read degrades to slip prices rather than
// to zeroes — a wrong-but-sane ticket beats a $0.00 one.
export async function loadRates(): Promise<RateMap> {
  const { data } = await supabase.from('game_rates').select('*').order('sort')
  return toRateMap(data as GameRate[] | null)
}
