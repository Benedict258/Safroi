# Safroi — Reframe & Build Instructions

Working document for OpenCode execution. Two sections: (1) the product reframe itself, (2) how the agent should approach the existing repo before building on it.

---

## 1. Reframe Instructions (for OpenCode)

### 1.1 Positioning
Safroi is being reframed from a general legal-risk analyzer into a **protection tool for people most exposed to exploitative contracts** — primarily **informal and gig workers reviewing employment agreements**, secondarily **low-income tenants reviewing leases**. This is the AI for Social Impact hackathon track entry (SDG 8 — Decent Work, SDG 10 — Reduced Inequalities).

The core detection engine is solid and does not need to be rebuilt — this is a reframe and feature-extension, not a rewrite.

### 1.2 New/Modified Features

**A. Photo & PDF Clause Highlighting**
- Photo upload: OCR the contract image, then visually highlight flagged clauses directly on the image — red for risky/exploitative clauses, green for standard/safe clauses. Prioritize OCR accuracy — this needs to be as close to perfect as achievable, since misread text produces wrong flags.
- PDF upload: identify each flagged clause's exact phrase and location (page number + approximate position) rather than only highlighting on an image render.
- Multi-page support required for both input types — contracts are rarely one page.

**B. Plain-Language Toggle**
- Add a clean UX toggle: **Legal View** ↔ **Plain View** for every flagged clause explanation.
- Legal View: the clause as-is plus a technical risk explanation.
- Plain View: the same clause explained in everyday language, no legal jargon — written so someone without legal literacy understands exactly what it means for them.
- Toggle should be global (switch once, applies across the whole document) with the option to override per-clause if the user wants to compare both.

**C. Caution Rating — Hybrid Model**
- Keep the existing 1–10 caution score per clause (fast visual scan).
- Add a short plain-language impact line alongside each score — e.g. *"This could mean you're let go with no notice and no final pay."* Concrete and specific to that clause, not generic.
- Category tags per flagged clause where possible (e.g. "Termination Risk," "Wage Deduction Risk," "Unpaid Overtime Risk") to help users recognize patterns across contracts, not just single incidents.

**D. Local Language Output**
- Priority order: **Hausa, Yoruba, English, Igbo**, then broader African languages as time allows.
- Applies to the Plain View explanations and caution impact lines — the goal is a user reading the risk explanation in the language they're most comfortable with, not just a translated UI shell.

**E. Existing Chrome Extension — Terms & Conditions / Privacy Policy Reader**
- Already built: reads ToS/privacy policy text on websites before the user clicks "I agree," surfacing what they're actually agreeing to.
- For this reframe: apply the same Plain View / caution rating / highlighting treatment developed for contracts (A–C above) to this feature too, so the whole product has one consistent detection-and-explanation language, not two disconnected systems.

**F. Existing Feature — Policy Update Tracking**
- Already built: tracks when a site updates its terms/policy and notifies the user.
- No structural change needed for this reframe — confirm it still fits the unified Plain View/caution-rating treatment once A–C are implemented, so a policy update notification also shows what specifically changed and its new risk level, not just "this policy was updated."

### 1.3 Explicitly Out of Scope for This Reframe
- Full legal-advice functionality — Safroi flags and explains risk, it does not replace a lawyer; keep this framing consistent in all UI copy
- Tenancy-specific contract logic — secondary use case, only pursue if employment-contract features are complete first
- Additional African languages beyond Hausa/Yoruba/Igbo/English unless time genuinely allows

### 1.4 Demo Plan
- One short (1–2 page), real employment contract, run through live: upload → OCR/highlight appears (red/green) → toggle Legal View to Plain View on at least one flagged clause → show the caution score + impact line + category tag
- If time allows: a second, quick demonstration of the Chrome extension flagging a real website's ToS using the same visual/explanation language, to show the product is one coherent system, not two separate tools bolted together

---

## 2. Repo Onboarding Instructions (for the Agent)

Before any new reframe work begins, the agent must understand what already exists and why, so new features integrate cleanly rather than duplicating or conflicting with existing logic.

**Do not delete, rewrite, or alter git history in any way.** The existing commit history is real prior work and stays intact exactly as-is.

**Steps:**
1. Pull the repository and review the full commit history — read commit messages and diffs chronologically to build an accurate understanding of what was built, in what order, and why.
2. Produce a short internal findings summary covering:
   - Current architecture: what the detection engine actually does today (general risk categories, as confirmed)
   - Where clause detection logic lives in the codebase (so new highlighting/OCR features hook into the existing engine rather than creating a parallel one)
   - How the existing Chrome extension's ToS-reading feature is structured, and whether it currently shares any code/logic with the main contract-analysis engine or is fully separate
   - How the policy-update-tracking feature currently determines and delivers a "site updated" notification
3. Flag any part of the existing codebase that will need modification (not replacement) to support: OCR-based highlighting, the plain-language toggle, the hybrid caution rating, and local-language output.
4. Once the findings summary is reviewed, begin implementing the reframe features from Section 1, building on top of the existing, unmodified history — new commits continue forward from the current state, clearly identifiable as the reframe/hackathon work layered on the established base.

**Reporting requirement:** as with prior builds, report specifically what was implemented and verified working per feature (A–F above), not just "done" — include a real test case output for at least the OCR-highlighting and plain-language toggle features before calling them complete.
