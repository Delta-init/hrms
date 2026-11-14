import { describe, expect, it } from "bun:test";
import { expiringDocs } from "./expiringDocs.js";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe("expiringDocs", () => {
  it("lists every dated document on a Dubai record", () => {
    const docs = expiringDocs({
      location: "dubai",
      visa: { expiryDate: d("2027-01-01") },
      passport: { expiryDate: d("2030-05-05") },
      emiratesId: { expiryDate: d("2027-01-02") },
      labourCard: { expiryDate: d("2026-12-01") },
      otherDocuments: [
        { _id: "a1", label: "Health insurance", expiryDate: d("2026-12-31") },
        { _id: "a2", label: "Driving licence", expiryDate: null },
      ],
    });
    expect(docs.map((x) => [x.doc, x.label, x.slot, x.expiryDay, x.isVisa])).toEqual([
      ["visa", "Visa", "visa_copy", "2027-01-01", true],
      ["passport", "Passport", "passport", "2030-05-05", false],
      ["emiratesId", "Emirates ID", "emirates_id", "2027-01-02", false],
      ["labourCard", "Labour card", "labour_card", "2026-12-01", false],
      ["other:a1", "Health insurance", "other:a1", "2026-12-31", false],
    ]);
  });

  it("leaves the visa out where the visa popup does — but not the rest", () => {
    expect(expiringDocs({ location: "dubai", visaNotRequired: true, visa: { expiryDate: d("2027-01-01") }, passport: { expiryDate: d("2030-01-01") } }).map((x) => x.doc)).toEqual(["passport"]);
    expect(expiringDocs({ location: "india", visa: { expiryDate: d("2027-01-01") }, passport: { expiryDate: d("2030-01-01") } }).map((x) => [x.doc, x.slot])).toEqual([["passport", "identity"]]);
  });

  it("is nothing when nothing is dated", () => {
    expect(expiringDocs({ location: "dubai" })).toEqual([]);
  });
});
