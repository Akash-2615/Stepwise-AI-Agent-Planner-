# Stepwise

Stepwise turns a goal into a validated, end-to-end action plan. It uses a
Planner–Critic Iterative Refinement architecture powered by Groq and presents
the result as both a conversational guide and an interactive vertical timeline.

The application creates plans only—it does not execute the generated steps.

## Features

- Breaks simple and complex goals into 3–8 ordered, actionable steps
- Adds dependencies and observable completion checks to every step
- Validates each plan for completeness, ordering, constraints, and goal alignment
- Sends rejected plans through a bounded Replanner → Validator correction loop
- Streams agent activity to the frontend in real time with Server-Sent Events
- Shows Waiting, Running, Done, Stopped, and Error architecture states
- Provides an interactive, animated architecture diagram
- Supports a fullscreen planning timeline
- Exports a professional PDF with branding, goal, date/time, timeline, completion
  checks, validation cycles, and final conversational guidance
- Clears previous plans, logs, and visual state before starting again

## Architecture

```text
Goal Input → Planning Orchestrator → Plan Validator
                                      ├─ Satisfied → Plan Finalizer → Plan Presenter
                                      └─ Needs correction → Plan Replanner
                                                               └─→ Plan Validator
```

### AI agents

1. **Planning Orchestrator** — converts the goal into an ordered plan.
2. **Plan Validator** — checks constraints, chronology, dependencies, gaps,
   completion criteria, and whether the plan reaches the requested outcome.
3. **Plan Replanner** — receives specific Validator issues and repairs the full
   plan before returning it for another validation cycle.
4. **Plan Finalizer** — turns the validated plan into a detailed,
   conversational guide.

The validation/replanning loop is capped to prevent an infinite run.

## Tech stack

- **Frontend:** React 19, Vite 8, CSS
- **Backend:** Python, FastAPI, Uvicorn
- **LLM provider:** Groq
- **Streaming:** Server-Sent Events
- **PDF generation:** jsPDF
- **Linting:** Oxlint

## Project structure

```text
.
├── src/
│   ├── App.jsx          # UI, SSE handling, timeline, and PDF export
│   └── App.css          # Responsive layout, architecture, and animations
├── server/
│   ├── agents.py        # Planner, Validator, Replanner, and Finalizer
│   ├── orchestrator.py  # Validation/replanning loop and streaming events
│   ├── llm.py           # Groq client and error handling
│   ├── main.py          # FastAPI routes
│   └── state.py         # Shared state and plan schemas
├── .env.example
└── package.json
```

## Setup

### Prerequisites

- Node.js 20+
- Python 3.11+
- A [Groq API key](https://console.groq.com/keys)

### Install dependencies

```bash
npm install
python3 -m pip install -r server/requirements.txt
```

### Configure environment variables

```bash
cp .env.example .env
```

Then add your Groq key:

```dotenv
GROQ_API_KEY=your_groq_api_key_here
GROQ_MODEL=llama-3.3-70b-versatile
GROQ_CRITIC_MODEL=llama-3.1-8b-instant
CRITIC_SEPARATE_JUDGE=true
PORT=3001
```

The `.env` file is ignored by Git and must never be committed.

## Run locally

```bash
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3001`
- API documentation: `http://localhost:3001/docs`

## API

### `GET /api/health`

Returns backend, provider, API-key, and architecture status.

### `GET /api/architecture`

Returns the architecture metadata used by the application.

### `POST /api/decompose`

Starts an SSE stream for a new goal:

```json
{
  "goal": "Learn SQL from scratch in 30 days"
}
```

The stream emits live events for planning, validation, replanning,
finalization, presentation, completion, and errors.

## Quality checks

```bash
npm run lint
npm run build
python3 -m py_compile server/agents.py server/orchestrator.py server/main.py
```

## Security

- Do not commit `.env` or API keys.
- Use `.env.example` only for placeholder configuration.
- Rotate a key immediately if it is ever exposed.
