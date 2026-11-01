// Firestore REST value encoding for the plain JSON the instance files use
// (strings, numbers, booleans, null, arrays, objects). Shared by the seed script and its test.
function enc(v) {
  if (v === null) return { nullValue: null };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  if (v && typeof v === "object") return { mapValue: { fields: fields(v) } };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  return { stringValue: String(v) };
}
const fields = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined).map(([k, v]) => [k, enc(v)]));
module.exports = { enc, fields };
