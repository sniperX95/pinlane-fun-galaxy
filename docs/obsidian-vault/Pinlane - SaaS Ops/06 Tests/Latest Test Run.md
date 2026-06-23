# Latest Test Run

Derniere synchronisation: 24/06/2026 00:39:47

## Commande

```bash
npm run test:ops:all
```

## Resultat

OK

## Sortie

```text
> test:ops:all
> npm run test:ops && npm run test:security-config && npm run test:browser-modules && npm run test:agent-stack && npm run test:agent-orchestration && npm run test:marketing-agents && npm run test:simulation && npm run test:ops:stress && npm run test:quality


> test:ops
> node scripts/run-ops-tests.js

ops-tests-ok

> test:security-config
> node scripts/run-security-config-tests.js

security-config-tests-ok

> test:browser-modules
> node scripts/run-browser-module-tests.js

browser-module-tests-ok

> test:agent-stack
> node scripts/run-agent-stack-tests.js

agent-stack-tests-ok

> test:agent-orchestration
> node scripts/run-agent-orchestration-tests.js

agent-orchestration-tests-ok iterations=10000 modes={"communication-agent":["active","runtime"],"delay-agent":["active","runtime"],"director-agent":["active"],"learning-agent":["active","collect"],"orchestrator-agent":["active"],"planning-agent":["active","runtime"],"qa-redteam-agent":["disponible","monitor"],"security-agent":["monitor"],"design-agent":["monitor"],"research-agent":["collect"]}

> test:marketing-agents
> node scripts/run-marketing-agent-tests.js

Marketing agent tests passed.

> test:simulation
> node scripts/run-simulation-tests.js

{
  "ok": true,
  "checks": {
    "simulationPlanShape": "ok",
    "planningSmokeIterations": 2500
  }
}

> test:ops:stress
> node scripts/run-ops-stress.js

ops-stress-ok iterations=5000 accepted=958 refused=4042 formula=2836 bowling=1333 laser=831 highOrCritical=369

> test:quality
> node scripts/run-quality-audit.js

Quality audit passed.
```
