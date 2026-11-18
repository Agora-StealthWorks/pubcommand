/**
 * A realistic analysis answer in the streamed section format, for unit tests
 * and for the local fake-AI server used to test the live view. Invented promo;
 * no real people or products.
 */

export const SAMPLE_COPY = `THE 4-MINUTE MORNING HABIT
Why one forgotten kitchen spice may matter more for your joints than anything in your medicine cabinet

Dear Reader,

My name is Dr. Alan Reyes. For 22 years I ran a joint clinic outside Denver, and I watched the same thing happen again and again.

Patients did everything right. They took the pills. They did the stretches. And still the stiffness came back every morning.

Then a patient of mine, a retired mail carrier named Walt, told me about something his grandmother used to stir into warm milk.

I laughed. Then I looked at the research. Our proprietary bio-synergistic absorption matrix leverages nano-emulsified curcuminoid pathways.

It is a great opportunity. Incredible results await you.

Members of Vital Gazette Letter report feeling 100% pain-free in days.

Here is what you get when you join Vital Gazette Letter today: twelve monthly issues, the Morning Ritual Guide, and The Joint Kitchen recipe book.

The regular price is $99 a year. Today you pay just $39. And you are covered by my 90-day, no-questions money-back guarantee.

This offer ends at midnight on XX DATE.`;

export const SAMPLE_ANSWER = `<<HEADLINE>>
**Eyebrow:** None
**Headline:** "The 4-Minute Morning Habit"
**Subhead:** Why one forgotten kitchen spice may matter more for your joints than anything in your medicine cabinet
- **Urgent**: weak — "Morning" gives a daily cue but nothing says act today.
- **Unique**: present – a forgotten kitchen spice beats the medicine cabinet is a fresh angle.
- **Ultra-specific**: present - "4-minute" and "kitchen spice" are concrete.
- **Useful**: present — joint relief is the reader's core desire.
Verdict: A strong curiosity headline with a clear benefit; urgency is left to the body.
<</HEADLINE>>

<<OUTLINE>>
1. The Lead — Opens with the 4-minute habit and the clinic doctor's frustration.
2. **Walt's Grandmother** — Introduces the folk remedy through a relatable patient story.
3. The Research — Tries to explain why the spice works.
4. The Offer — Presents the newsletter, bonuses, price and guarantee.
<</OUTLINE>>

<<SIXTEEN_WORD>>
Q1 — Strong — A kitchen spice beating the medicine cabinet is new to this reader.
Q2 — Strong — Mornings without stiffness.
Q3 — Present but weak — Walt's story helps, but "the research" is never named.
Q4 — Missing — The reader's doubt about yet another remedy is not addressed.
Q5 — Present but weak — Pills are blamed lightly.
Q6 — Missing — No reason given why now.
Q7 — Strong — 22 years running a joint clinic.
Q8 — Present but weak — The mechanism is buried in jargon.
Q9 — Strong — Join today, clear steps.
Q10 — Strong — 90-day money-back guarantee.
C1 — Strong — The Morning Ritual Guide is revealed.
C2 — Strong — The guide comes with membership.
C3 — Missing — No testimonials yet.
C4 — Strong — $99 anchor.
C5 — Present but weak — Bonuses are named but not valued.
C6 — Missing — No value stack.
C7 — Strong — $39 today.
C8 — Strong — 90 days, no questions.
Verdict: The story and offer follow the framework well; the mechanism and the reader's doubts need work.
<</SIXTEEN_WORD>>

<<CUB>>
[
  {"text": "Our proprietary bio-synergistic absorption matrix leverages nano-emulsified curcuminoid pathways.", "type": "confusing", "reason": "Dense jargon this reader will not follow."},
  {"text": "Members of Vital Gazette Letter report feeling 100% pain-free in days.", "type": "unbelievable", "reason": "A total-relief claim with no support, and it breaks the brand's health rules."},
  {"text": "It is a great opportunity. Incredible results await you.", "type": "boring", "reason": "Filler that says nothing."}
]
<</CUB>>

<<OFFER>>
- **Big idea:** A forgotten kitchen spice, taken the right way each morning, may ease stiff joints better than the medicine cabinet.
- **Publisher:** Gazette Health (inferred, low confidence)
- **Product:** Vital Gazette Letter
- **What it is:** Monthly health newsletter
- **Prices:** $99 a year regular; $39 today
- **Payment options:** Yearly
- **Premiums:**
  - The Morning Ritual Guide
  - The Joint Kitchen
- **Guarantee:** 90-day money-back, no questions
- **Urgency:** Offer ends at midnight
<</OFFER>>

<<TEASE>>
Teased: an ingredient (a kitchen spice)
Clues:
- Grandmother stirred it into warm milk
- Linked to "curcuminoid" compounds
Guesses:
- Turmeric — warm milk and curcuminoids point straight to it
Confidence: High
<</TEASE>>

<<INTEL>>
{"expert": {"name": "Dr. Alan Reyes", "backstory": ["Ran a joint clinic outside Denver for 22 years"], "credentials": ["Doctor"], "approach": "Pairs folk remedies with research.", "credibility": "Credible clinic background, thin on named research."},
 "product": {"name": "Vital Gazette Letter", "type": "newsletter", "offers": "Twelve monthly issues plus two guides", "mechanism": "A morning spice ritual", "promise": "Less morning stiffness", "proof": ["Patient story (LIVE)"], "backtests": null},
 "publication": "Vital Gazette Letter", "strategies": ["Morning ritual"], "topics": ["joint health", "natural remedies"], "beliefs": ["Old remedies are overlooked"], "other_products": [], "audience_signals": ["Older adults with stiff joints"], "notable_facts": []}
<</INTEL>>

<<SCORECARD>>
1. **Hook Strength:** 8/10 — Scores 8 because the forgotten-spice promise stops a stiff-jointed reader.
2. Believability: 6/10 — Scores 6 because the clinic years help but the research is never named.
3. Specificity – 7 / 10: Scores 7 because "4 minutes" and "22 years" are concrete.
4. Emotional Pull: 7/10 — Scores 7 because Walt's story is warm and relatable.
5. Momentum: 7/10 — Scores 7 because the story pulls the reader forward.
6. Offer Clarity: 8/10 — Scores 8 because the price, bonuses and guarantee are plain.
7. Call to Action / Urgency: 6/10 — Scores 6 because the midnight deadline is the only pull.
8. Audience Fit: 8/10 — Scores 8 because it speaks the language of skeptical older readers.
Adjustment: +0.3 — The patient story is the kind that has outperformed for this brand.
Rationale: I would bet on this one with fixes. The hook and offer are strong; naming the research and dropping the jargon would lift it.
<</SCORECARD>>`;
