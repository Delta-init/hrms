/**
 * Turn a coordinate into an address.
 *
 * Deliberately the one place in this codebase that sends a location to a third
 * party. The IP lookup beside it is offline on purpose — an address for every
 * employee's home connection is not worth handing to anyone — but a street name
 * cannot be derived from an offline table, and reading "10.0655, 76.3223" tells
 * nobody whether somebody was where they said they were.
 *
 * So the trade is made narrowly. Only a punch that already carries a GPS fix is
 * looked up, only once per place, and only the coordinate goes: no name, no
 * employee, no address of ours. Nominatim is used because it needs no key and
 * no account, which means no third party holding a record of who asked.
 *
 * It must never cost somebody their punch. Every failure — a timeout, a rate
 * limit, an outage — leaves the coordinates exactly as they were and the punch
 * goes through, because where somebody stood is the fact and the street name is
 * only a convenience laid over it.
 */

/** Nominatim's terms require a real identifier; an anonymous caller is blocked. */
const UA = "DeltaHRMS/1.0 (attendance location lookup; contact hr@deltainstitutions.com)";
const ENDPOINT = "https://nominatim.openstreetmap.org/reverse";

/**
 * Short enough that a punch is never left waiting on somebody else's server.
 * A clock-in that takes four seconds because a map service is slow is a worse
 * outcome than a row that shows coordinates instead of a street.
 */
const TIMEOUT_MS = 3_000;

export interface ResolvedAddress {
  road?: string | null;
  suburb?: string | null;
  city?: string | null;
  district?: string | null;
  state?: string | null;
  postcode?: string | null;
  country?: string | null;
  countryCode?: string | null;
  /** The whole thing as one line, as the service itself phrases it. */
  label?: string | null;
}

/**
 * Places already looked up, keyed to about a hundred metres.
 *
 * Somebody punches from the same desk every morning, and a hundred people
 * punching from one office is one place, not a hundred. Rounding to three
 * decimals collapses those into a single lookup — which is both the courteous
 * thing to do to a free service and the fast one, since the answer is already
 * in hand by the second punch of the day.
 */
const cache = new Map<string, ResolvedAddress | null>();
const CACHE_LIMIT = 2_000;

function key(lat: number, lng: number) {
  return `${lat.toFixed(3)},${lng.toFixed(3)}`;
}

/** Nominatim's field names vary by country; these are the ones that carry a town. */
function pick(a: Record<string, string | undefined>, ...names: string[]) {
  for (const n of names) if (a[n]) return a[n]!;
  return null;
}

export async function reverseGeocode(lat: number, lng: number): Promise<ResolvedAddress | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const k = key(lat, lng);
  if (cache.has(k)) return cache.get(k)!;

  // Asked for in English. Left to itself the service answers in whichever
  // language the place speaks, so a Dubai punch came back as
  // "شارع المركز المالي, برج خليفة" — correct, and unreadable to the HR team in
  // Kerala who have to reconcile it against a name they typed in English.
  const url = `${ENDPOINT}?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&accept-language=en`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json", "Accept-Language": "en" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`nominatim ${res.status}`);
    const json = (await res.json()) as { display_name?: string; address?: Record<string, string> };
    const a = json.address ?? {};
    const out: ResolvedAddress = {
      road: pick(a, "road", "pedestrian", "footway", "residential"),
      suburb: pick(a, "suburb", "neighbourhood", "quarter", "village", "hamlet"),
      // A "city" is called a dozen things depending on where you are standing.
      city: pick(a, "city", "town", "municipality", "village"),
      district: pick(a, "state_district", "county", "district"),
      state: pick(a, "state", "region"),
      postcode: a.postcode ?? null,
      country: a.country ?? null,
      countryCode: a.country_code ? a.country_code.toUpperCase() : null,
      label: json.display_name ?? null,
    };
    // A reply with nothing in it is still an answer worth remembering, so the
    // same empty patch of map is not asked about twice.
    if (cache.size > CACHE_LIMIT) cache.clear();
    cache.set(k, out);
    return out;
  } catch {
    // Not cached: a timeout says nothing about the place, and the next punch
    // from that desk deserves a fresh attempt rather than inheriting a failure.
    return null;
  }
}
