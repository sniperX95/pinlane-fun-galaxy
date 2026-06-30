# Pinlane Project Instructions

## Agency OS

For this repository, use `.agents/skills/pinlane-agency-os/SKILL.md` as the default second brain for product, UX, operations, marketing, planning, agent, email, QA, deployment and security work.

The source import lives in `ops-knowledge/agency-agents-reference.json`, generated from `https://github.com/msitarzewski/agency-agents` under MIT license.

Keep the model practical:

- Use only the agency roles that help the current task.
- Do not add fake agents or fake autonomy.
- Do not let a generative agent confirm a booking, invent availability, change prices or send sensitive messages.
- The deterministic planning engine remains the source of truth for bowling, laser, formulas and delay handling.
- UI must stay KISS: fewer choices, clearer hierarchy, no decorative clutter, no phantom buttons.
- Every visible button must either work or be removed.
- Verify affected flows before reporting completion.

