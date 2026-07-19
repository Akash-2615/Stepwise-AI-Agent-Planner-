import { useEffect, useRef, useState } from 'react'
import './App.css'

const ARCHITECTURE = [
  {
    id: 'goal_input',
    label: 'Goal Input',
    subtitle: 'Collects your objective',
    type: 'Input',
    info:
      'Captures the goal, deadline, budget, scope, and constraints, then passes them to the Planning Orchestrator.',
    color: '#2563eb',
    tint: '#dbeafe',
  },
  {
    id: 'planning_orchestrator',
    label: 'Planning Orchestrator',
    subtitle: 'Creates the ordered plan',
    type: 'AI Agent',
    info:
      'Analyzes complexity and breaks the goal into 3–8 ordered steps with dependencies and completion checks.',
    color: '#0d9488',
    tint: '#ccfbf1',
  },
  {
    id: 'plan_validator',
    label: 'Plan Validator',
    subtitle: 'Checks plan correctness',
    type: 'AI Agent',
    info:
      'Checks constraints, ordering, dependencies, missing work, completion checks, and whether the final outcome satisfies the goal.',
    color: '#dc2626',
    tint: '#fee2e2',
  },
  {
    id: 'plan_replanner',
    label: 'Plan Replanner',
    subtitle: 'Corrects validator issues',
    type: 'AI Agent',
    info:
      'Runs only when validation fails. It receives the Validator issues, repairs the complete plan, and sends it back for validation.',
    color: '#d97706',
    tint: '#fef3c7',
  },
  {
    id: 'plan_finalizer',
    label: 'Plan Finalizer',
    subtitle: 'Writes the final guide',
    type: 'AI Agent',
    info:
      'Runs after validation and turns the approved plan into a detailed conversational response for the user.',
    color: '#7c3aed',
    tint: '#ede9fe',
  },
  {
    id: 'plan_presenter',
    label: 'Plan Presenter',
    subtitle: 'Displays plan and timeline',
    type: 'Output',
    info:
      'Formats the generated steps into a conversational guide and vertical timeline.',
    color: '#059669',
    tint: '#d1fae5',
  },
]

const NODE = Object.fromEntries(ARCHITECTURE.map((node) => [node.id, node]))

const EXAMPLES = [
  {
    label: 'Launch a small business',
    goal:
      'Launch a weekend farmers market stall in 8 weeks with a ₹50,000 budget, including permits, suppliers, pricing, branding, staffing, and launch-day preparation.',
  },
  {
    label: 'Build a training plan',
    goal:
      'Train for my first 10K race in 12 weeks. I can train four days per week and need a progressive plan covering running, strength, recovery, and race preparation.',
  },
  {
    label: 'Plan a technical migration',
    goal:
      'Migrate an existing React application to TypeScript safely without interrupting production. Include auditing, configuration, phased conversion, testing, CI updates, and rollout.',
  },
  {
    label: 'Plan a constrained trip',
    goal:
      'Plan a two-week trip to Japan for two people within a ₹3,00,000 total budget, including itinerary, transport, accommodation, food, bookings, and contingency planning.',
  },
]

function formatApiError(message) {
  if (!message) return 'Something went wrong'
  const text = String(message)
  if (/connection error|could not reach groq|apiconnection/i.test(text)) {
    return 'Groq connection failed. Check the backend network and try again.'
  }
  if (/429|rate.?limit|quota/i.test(text)) {
    return 'Groq rate limit reached. Wait briefly and try again.'
  }
  return text
}

async function exportPlanToPdf({ goal, plan, finalAnswer, loopCount, generatedAt }) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 14
  const contentWidth = pageWidth - margin * 2
  const footerY = pageHeight - 9
  const lineHeight = 5
  const created = generatedAt ? new Date(generatedAt) : new Date()
  const generatedDay = created.toLocaleDateString(undefined, { weekday: 'long' })
  const generatedDate = created.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
  const generatedTime = created.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  let y = 0

  const safeText = (value) =>
    String(value || '')
      .replaceAll('₹', 'INR ')
      .replaceAll('•', '-')
      .replace(/[–—]/g, '-')
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')

  function drawPageHeader() {
    doc.setFillColor(16, 35, 29)
    doc.rect(0, 0, pageWidth, 24, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(17)
    doc.text('STEPWISE', margin, 10)
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.text('Planner-Critic Iterative Refinement Architecture', margin, 16)
    doc.text('Goal Decomposition Report', pageWidth - margin, 10, { align: 'right' })
    y = 31
  }

  function nextPage() {
    doc.addPage()
    drawPageHeader()
  }

  function sectionHeading(title) {
    if (y > footerY - 12) nextPage()
    doc.setTextColor(13, 122, 111)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.text(safeText(title), margin, y)
    doc.setDrawColor(13, 122, 111)
    doc.line(margin, y + 2, pageWidth - margin, y + 2)
    y += 8
  }

  function textBox(title, text, color = [13, 122, 111], timeline = null) {
    const normalized = safeText(text)
    const boxX = timeline ? margin + 14 : margin
    const boxWidth = timeline ? contentWidth - 14 : contentWidth
    const lines = doc.splitTextToSize(normalized, boxWidth - 10)
    let cursor = 0
    let part = 1

    while (cursor < lines.length || (lines.length === 0 && part === 1)) {
      const available = footerY - y - 12
      if (available < 14) {
        nextPage()
        continue
      }
      const maxLines = Math.max(1, Math.floor(available / lineHeight))
      const chunk = lines.slice(cursor, cursor + maxLines)
      const boxHeight = 9 + Math.max(1, chunk.length) * lineHeight

      if (timeline) {
        const markerX = margin + 5
        const markerY = y + 6
        const hasMore =
          cursor + chunk.length < lines.length || timeline.index < timeline.total - 1
        if (hasMore) {
          doc.setDrawColor(153, 216, 207)
          doc.setLineWidth(0.8)
          doc.line(markerX, markerY + 4, markerX, y + boxHeight + 4)
        }
        doc.setFillColor(204, 251, 241)
        doc.circle(markerX, markerY, 5, 'F')
        doc.setFillColor(13, 122, 111)
        doc.circle(markerX, markerY, 3.8, 'F')
        doc.setTextColor(255, 255, 255)
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(7)
        doc.text(String(timeline.index + 1), markerX, markerY + 1, {
          align: 'center',
        })
      }

      doc.setLineWidth(timeline ? 0.7 : 0.3)
      doc.setDrawColor(...color)
      doc.setFillColor(250, 252, 251)
      doc.roundedRect(boxX, y, boxWidth, boxHeight, 2, 2, 'FD')
      doc.setTextColor(...color)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8.5)
      doc.text(
        part === 1 ? safeText(title) : `${safeText(title)} (continued)`,
        boxX + 5,
        y + 5.5,
      )
      doc.setTextColor(34, 51, 45)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8.5)
      if (chunk.length) doc.text(chunk, boxX + 5, y + 11)

      y += boxHeight + 4
      cursor += chunk.length
      part += 1
      if (cursor < lines.length) nextPage()
      if (lines.length === 0) break
    }
  }

  drawPageHeader()
  doc.setProperties({
    title: `Stepwise Plan - ${safeText(goal)}`,
    subject: 'Goal decomposition plan and timeline',
    author: 'Stepwise',
  })

  textBox(
    'PLAN DETAILS',
    [
      `Goal: ${goal}`,
      `Day: ${generatedDay}`,
      `Date: ${generatedDate}`,
      `Time: ${generatedTime}`,
      `Plan status: Validated and ready`,
      `Total steps: ${plan.length}`,
      `Validation review cycles: ${loopCount || 0}`,
      `Replanning rounds: ${Math.max((loopCount || 0) - 1, 0)}`,
      'Architecture: Planner-Critic Iterative Refinement',
    ].join('\n'),
    [37, 99, 235],
  )

  sectionHeading('Step-by-step planning timeline')
  plan.forEach((step, index) => {
    const details = [
      step.description,
      '',
      'Completion checks:',
      ...(step.acceptance_criteria || []).map((criterion) => `- ${criterion}`),
      ...(step.dependencies?.length
        ? ['', `Complete after: ${step.dependencies.join(', ')}`]
        : []),
    ].join('\n')
    textBox(`STEP ${index + 1} OF ${plan.length}`, details, [13, 122, 111], {
      index,
      total: plan.length,
    })
  })

  sectionHeading('Final conversational guidance')
  textBox('HOW TO USE THIS PLAN', finalAnswer, [124, 58, 237])

  const totalPages = doc.getNumberOfPages()
  for (let page = 1; page <= totalPages; page += 1) {
    doc.setPage(page)
    doc.setDrawColor(190, 204, 198)
    doc.line(margin, footerY - 3, pageWidth - margin, footerY - 3)
    doc.setTextColor(82, 100, 93)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.text(`Stepwise | ${created.toLocaleString()}`, margin, footerY)
    doc.text(`Page ${page} of ${totalPages}`, pageWidth - margin, footerY, {
      align: 'right',
    })
  }

  const fileGoal =
    safeText(goal)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 42) || 'goal-plan'
  doc.save(`stepwise-${fileGoal}.pdf`)
}

function ArchitectureCard({
  node,
  number,
  active,
  visited,
  infoOpen,
  onToggleInfo,
}) {
  return (
    <article
      className={`simple-node interactive-node ${active ? 'active' : ''} ${
        visited && !active ? 'visited' : ''
      } ${infoOpen ? 'info-open' : ''}`}
      style={{
        '--agent-color': node.color,
        '--agent-tint': node.tint,
      }}
      onClick={(event) => onToggleInfo(event, node.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onToggleInfo(event, node.id)
        }
      }}
      tabIndex={0}
      aria-expanded={infoOpen}
      aria-label={`${node.label}: ${node.subtitle}`}
    >
      <span className="node-number">
        {typeof number === 'number' ? String(number).padStart(2, '0') : number}
      </span>
      <strong>{node.label}</strong>
      <small>{node.subtitle}</small>
      <em>{node.type}</em>
      <button
        type="button"
        className="info-btn"
        aria-expanded={infoOpen}
        aria-label={`About ${node.label}`}
        onClick={(event) => onToggleInfo(event, node.id)}
      >
        i
      </button>
      {infoOpen && (
        <div className="click-popover" onClick={(event) => event.stopPropagation()}>
          <b>{node.type}</b>
          <p>{node.info}</p>
        </div>
      )}
      {active && <span className="now-badge">working</span>}
    </article>
  )
}

function App() {
  const [goal, setGoal] = useState('')
  const [running, setRunning] = useState(false)
  const [hasKey, setHasKey] = useState(null)
  const [activeNode, setActiveNode] = useState(null)
  const [visitedNodes, setVisitedNodes] = useState([])
  const [openInfo, setOpenInfo] = useState(null)
  const [validationStatus, setValidationStatus] = useState(null)
  const [timelineFullscreen, setTimelineFullscreen] = useState(false)
  const [loopCount, setLoopCount] = useState(0)
  const [generatedAt, setGeneratedAt] = useState(null)
  const [plan, setPlan] = useState([])
  const [trace, setTrace] = useState([])
  const [finalAnswer, setFinalAnswer] = useState('')
  const [summary, setSummary] = useState('')
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')
  const abortRef = useRef(null)
  const stoppedRef = useRef(false)
  const logRef = useRef(null)

  useEffect(() => {
    fetch('/api/health')
      .then((response) => response.json())
      .then((data) => setHasKey(data.hasKey))
      .catch(() => setHasKey(false))
  }, [])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [trace])

  useEffect(() => {
    function closeFullscreen(event) {
      if (event.key === 'Escape') setTimelineFullscreen(false)
    }
    window.addEventListener('keydown', closeFullscreen)
    return () => window.removeEventListener('keydown', closeFullscreen)
  }, [])

  function markNode(node) {
    if (!node) return
    setActiveNode(node)
    setVisitedNodes((previous) =>
      previous.includes(node) ? previous : [...previous, node],
    )
  }

  function pushTrace(entry) {
    if (stoppedRef.current) return
    setTrace((previous) => [
      ...previous,
      { ...entry, id: `${entry.node}-${entry.phase}-${previous.length}` },
    ])
  }

  function handleEvent(event, data) {
    if (stoppedRef.current) return

    if (event === 'tick') {
      let node = data.agent
      if (data.agent === 'orchestrator' && data.phase === 'complete') {
        node = 'plan_presenter'
      }
      markNode(node)

      if (data.state?.plan) setPlan(data.state.plan)
      if (data.plan) setPlan(data.plan)
      if (data.final_answer) setFinalAnswer(data.final_answer)
      if (data.summary) setSummary(data.summary)
      if (Number.isFinite(data.state?.iteration)) {
        setLoopCount(data.state.iteration)
      } else if (Number.isFinite(data.iteration)) {
        setLoopCount(data.iteration)
      }
      if (data.phase === 'corrections_needed') setValidationStatus('fail')
      if (data.phase === 'satisfied') setValidationStatus('pass')
      if (data.phase === 'revised') setValidationStatus('rechecking')

      if (data.phase === 'error') {
        setError(formatApiError(data.message))
        setStatus('error')
      }
      if (data.phase === 'final_plan' || data.phase === 'complete') {
        setStatus('success')
        setGeneratedAt((current) => current || new Date().toISOString())
      }

      pushTrace({
        node: node || 'system',
        phase: data.phase,
        text:
          data.note ||
          data.summary ||
          data.message ||
          data.phase,
      })
    }

    if (event === 'complete') {
      if (data.plan) setPlan(data.plan)
      if (data.final_answer) setFinalAnswer(data.final_answer)
      if (data.summary) setSummary(data.summary)
      if (Number.isFinite(data.iterations)) setLoopCount(data.iterations)
      setStatus(data.status || 'success')
      setGeneratedAt((current) => current || new Date().toISOString())
    }

    if (event === 'error') {
      setError(formatApiError(data.message))
      setStatus('error')
    }
  }

  async function startPlanning(event) {
    event?.preventDefault()
    if (!goal.trim() || running) return

    stoppedRef.current = false
    setRunning(true)
    setStatus('running')
    setError('')
    setPlan([])
    setTrace([])
    setFinalAnswer('')
    setSummary('')
    setActiveNode(null)
    setVisitedNodes([])
    setOpenInfo(null)
    setValidationStatus(null)
    setLoopCount(0)
    setGeneratedAt(null)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const response = await fetch('/api/decompose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal: goal.trim() }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.detail || `Request failed (${response.status})`)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (!stoppedRef.current) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const chunks = buffer.split('\n\n')
        buffer = chunks.pop() || ''

        for (const chunk of chunks) {
          if (stoppedRef.current) break
          let eventName = 'message'
          let dataLine = ''
          for (const line of chunk.split('\n')) {
            if (line.startsWith('event:')) eventName = line.slice(6).trim()
            if (line.startsWith('data:')) dataLine += line.slice(5).trim()
          }
          if (dataLine) handleEvent(eventName, JSON.parse(dataLine))
        }
      }
    } catch (requestError) {
      if (requestError.name === 'AbortError' || stoppedRef.current) {
        setStatus('stopped')
      } else {
        setError(formatApiError(requestError.message))
        setStatus('error')
      }
    } finally {
      setRunning(false)
      setActiveNode(null)
      abortRef.current = null
    }
  }

  function stopPlanning(event) {
    event?.preventDefault()
    stoppedRef.current = true
    abortRef.current?.abort()
    setRunning(false)
    setActiveNode(null)
    setStatus('stopped')
  }

  function clearPlan() {
    setGoal('')
    setPlan([])
    setTrace([])
    setFinalAnswer('')
    setSummary('')
    setError('')
    setStatus('idle')
    setActiveNode(null)
    setVisitedNodes([])
    setOpenInfo(null)
    setValidationStatus(null)
    setLoopCount(0)
    setGeneratedAt(null)
    setTimelineFullscreen(false)
  }

  function toggleInfo(event, nodeId) {
    event.stopPropagation()
    setOpenInfo((current) => (current === nodeId ? null : nodeId))
  }

  const architectureRunState = running
    ? 'running'
    : status === 'error'
      ? 'error'
      : status === 'stopped'
        ? 'stopped'
        : finalAnswer
          ? 'done'
          : 'waiting'

  const architectureRunLabel = {
    running: 'Running',
    done: 'Done',
    error: 'Error',
    stopped: 'Stopped',
    waiting: 'Waiting',
  }[architectureRunState]

  return (
    <div className="app simple-screen" onClick={() => setOpenInfo(null)}>
      <div className="atmosphere" aria-hidden="true" />

      <header className="top-bar">
        <div className="brand-block">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true" />
            <h1>Stepwise</h1>
          </div>
          <div className="arch-names">
            <strong>Planner–Critic Iterative Refinement Architecture</strong>
            <span>Plan → validate → refine when needed → finalize</span>
          </div>
        </div>
        <div className={`key-pill ${hasKey ? 'ok' : hasKey === false ? 'bad' : ''}`}>
          {hasKey === null && 'Checking Groq…'}
          {hasKey === true && 'Groq connected'}
          {hasKey === false && 'Add GROQ_API_KEY'}
        </div>
      </header>

      <section className="simple-architecture" aria-label="Planning architecture">
        <div className="architecture-heading">
          <div>
            <h2>Planner–Critic feedback flow</h2>
            <p>
              The approved path moves directly to Finalizer. Only rejected plans enter the
              correction loop.
            </p>
          </div>
          <div className="architecture-status">
            <strong>ITERATIVE REFINEMENT</strong>
            <span className={`architecture-run-status ${architectureRunState}`}>
              <i aria-hidden="true" />
              {architectureRunLabel}
            </span>
            <span>
              {running
                ? loopCount > 0
                  ? `Validation cycle ${loopCount}`
                  : 'Creating initial plan'
                : finalAnswer
                  ? `${loopCount} validation cycle${loopCount === 1 ? '' : 's'}`
                  : 'No run yet'}
            </span>
          </div>
        </div>

        <div
          className={`flow-diagram ${running ? 'is-running' : ''} ${
            finalAnswer ? 'is-complete' : ''
          }`}
        >
          <div className="main-flow-node goal-node">
            <ArchitectureCard
              node={NODE.goal_input}
              number={1}
              active={activeNode === 'goal_input'}
              visited={visitedNodes.includes('goal_input')}
              infoOpen={openInfo === 'goal_input'}
              onToggleInfo={toggleInfo}
            />
          </div>
          <span
            className={`diagram-arrow arrow-goal ${
              visitedNodes.includes('planning_orchestrator') ? 'on' : ''
            }`}
          >
            →
          </span>
          <div className="main-flow-node planner-node">
            <ArchitectureCard
              node={NODE.planning_orchestrator}
              number={2}
              active={activeNode === 'planning_orchestrator'}
              visited={visitedNodes.includes('planning_orchestrator')}
              infoOpen={openInfo === 'planning_orchestrator'}
              onToggleInfo={toggleInfo}
            />
          </div>
          <span
            className={`diagram-arrow arrow-planner ${
              visitedNodes.includes('plan_validator') ? 'on' : ''
            }`}
          >
            →
          </span>
          <div className="main-flow-node validator-node">
            <ArchitectureCard
              node={NODE.plan_validator}
              number={3}
              active={activeNode === 'plan_validator'}
              visited={visitedNodes.includes('plan_validator')}
              infoOpen={openInfo === 'plan_validator'}
              onToggleInfo={toggleInfo}
            />
          </div>
          <div
            className={`reject-inline-route ${
              visitedNodes.includes('plan_replanner') ? 'on' : ''
            }`}
          >
            <span>✕ Needs correction</span>
            <b>→</b>
          </div>
          <div className="main-flow-node replanner-node">
            <ArchitectureCard
              node={NODE.plan_replanner}
              number={4}
              active={activeNode === 'plan_replanner'}
              visited={visitedNodes.includes('plan_replanner')}
              infoOpen={openInfo === 'plan_replanner'}
              onToggleInfo={toggleInfo}
            />
          </div>
          <div className="conditional-gap" aria-hidden="true" />
          <div className="main-flow-node finalizer-node">
            <ArchitectureCard
              node={NODE.plan_finalizer}
              number={5}
              active={activeNode === 'plan_finalizer'}
              visited={visitedNodes.includes('plan_finalizer')}
              infoOpen={openInfo === 'plan_finalizer'}
              onToggleInfo={toggleInfo}
            />
          </div>
          <span
            className={`diagram-arrow arrow-finalizer ${
              visitedNodes.includes('plan_presenter') ? 'on' : ''
            }`}
          >
            →
          </span>
          <div className="main-flow-node presenter-node">
            <ArchitectureCard
              node={NODE.plan_presenter}
              number={6}
              active={activeNode === 'plan_presenter'}
              visited={visitedNodes.includes('plan_presenter')}
              infoOpen={openInfo === 'plan_presenter'}
              onToggleInfo={toggleInfo}
            />
          </div>

          <div
            className={`approved-bypass ${
              validationStatus === 'pass' || visitedNodes.includes('plan_finalizer') ? 'on' : ''
            }`}
          >
            <svg
              className="route-corner left"
              width="18"
              height="26"
              viewBox="0 0 18 26"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M2 26 L2 6 Q2 2 6 2 L18 2"
                stroke="currentColor"
                strokeWidth="4"
              />
            </svg>
            <span className="route-mid" />
            <svg
              className="route-corner right"
              width="22"
              height="26"
              viewBox="0 0 22 26"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M0 2 L12 2 Q16 2 16 6 L16 18"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path d="M10 18 L22 18 L16 26 Z" fill="currentColor" />
            </svg>
            <span className="route-label">✓ Satisfied: go directly to Finalizer</span>
          </div>
          <div
            className={`return-bypass ${
              visitedNodes.includes('plan_replanner') ? 'on' : ''
            }`}
          >
            <svg
              className="route-corner left"
              width="18"
              height="26"
              viewBox="0 0 18 26"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M18 24 L9 24 Q5 24 5 20 L5 8"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path d="M0 8 L10 8 L5 0 Z" fill="currentColor" />
            </svg>
            <span className="route-mid" />
            <svg
              className="route-corner right"
              width="22"
              height="26"
              viewBox="0 0 22 26"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M16 0 L16 20 Q16 24 12 24 L0 24"
                stroke="currentColor"
                strokeWidth="4"
              />
            </svg>
            <span className="route-label">Revised plan returns to Validator</span>
          </div>
        </div>
      </section>

      <main className="planning-layout">
        <div className="left-column">
          <section className="compose panel">
            <form onSubmit={startPlanning} className="goal-form">
              <div className="goal-heading">
                <label htmlFor="goal">What do you want to achieve?</label>
                <small>Add scope, deadline, budget, constraints, and desired result.</small>
              </div>
              <textarea
                id="goal"
                rows={3}
                value={goal}
                onChange={(event) => setGoal(event.target.value)}
                placeholder="Example: Build and launch a portfolio website in 4 weeks using React, with mobile support, testing, and deployment."
                disabled={running}
              />
              <div className="examples">
                {EXAMPLES.map((example) => (
                  <button
                    key={example.label}
                    type="button"
                    className="chip"
                    disabled={running}
                    onClick={() => setGoal(example.goal)}
                    title={example.goal}
                  >
                    <span>{example.label}</span>
                    <small>Use structured example</small>
                  </button>
                ))}
              </div>
              <div className="actions">
                {!running ? (
                  <button type="submit" className="btn primary" disabled={!goal.trim()}>
                    Create step-by-step plan
                  </button>
                ) : (
                  <button type="button" className="btn ghost" onClick={stopPlanning}>
                    Stop
                  </button>
                )}
                {status === 'success' && (
                  <span className="status-done success">
                    Plan ready · {plan.length} steps · {loopCount} validation cycle
                    {loopCount === 1 ? '' : 's'}
                  </span>
                )}
                {status === 'stopped' && <span className="status-done stopped">Stopped</span>}
                {finalAnswer && plan.length > 0 && (
                  <button
                    type="button"
                    className="btn pdf"
                    onClick={() =>
                      exportPlanToPdf({
                        goal,
                        plan,
                        finalAnswer,
                        loopCount,
                        generatedAt,
                      })
                    }
                  >
                    Export plan as PDF
                  </button>
                )}
                {!running && (goal || plan.length > 0 || trace.length > 0) && (
                  <button type="button" className="btn clear" onClick={clearPlan}>
                    Clear previous plan
                  </button>
                )}
              </div>
            </form>
            {error && <p className="error">{error}</p>}
          </section>

          <section className="panel plan-guide">
            <header className="panel-head">
              <h2>Your step-by-step guide</h2>
              <span>{finalAnswer ? 'ready' : 'waiting for a goal'}</span>
            </header>
            <div className="panel-scroll">
              {finalAnswer ? (
                <>
                  <p className="final-answer">{finalAnswer}</p>
                  {summary && <p className="summary success">{summary}</p>}
                </>
              ) : (
                <p className="empty">
                  Your conversational plan will appear here beneath the question.
                </p>
              )}
            </div>
          </section>
        </div>

        <section
          className={`panel vertical-timeline-panel ${
            timelineFullscreen ? 'timeline-fullscreen' : ''
          } timeline-${status}`}
        >
          <header className="panel-head">
            <h2>Plan from start to finish</h2>
            <div className="timeline-actions">
              <span>
                {plan.length} steps · {loopCount} validation cycle
                {loopCount === 1 ? '' : 's'}
              </span>
              {finalAnswer && plan.length > 0 && (
                <button
                  type="button"
                  className="expand-btn pdf-download"
                  onClick={() =>
                    exportPlanToPdf({
                      goal,
                      plan,
                      finalAnswer,
                      loopCount,
                      generatedAt,
                    })
                  }
                >
                  Download PDF
                </button>
              )}
              <button
                type="button"
                className="expand-btn"
                onClick={() => setTimelineFullscreen((current) => !current)}
              >
                {timelineFullscreen ? 'Close full screen' : 'Full screen'}
              </button>
            </div>
          </header>
          <div className="vertical-timeline-scroll">
            {plan.length === 0 ? (
              <p className="empty">The ordered plan will appear here as a vertical timeline.</p>
            ) : (
              <ol className="vertical-timeline">
                {plan.map((step, index) => (
                  <li
                    key={step.id || index}
                    className="vertical-step"
                    style={{ '--step-index': index }}
                  >
                    <div className="vertical-marker">
                      <span>{String(index + 1).padStart(2, '0')}</span>
                      {index < plan.length - 1 && <i aria-hidden="true" />}
                    </div>
                    <article>
                      <h3>{step.description}</h3>
                      {step.acceptance_criteria?.length > 0 && (
                        <>
                          <h4>Completion checks</h4>
                          <ul>
                            {step.acceptance_criteria.map((criterion, criterionIndex) => (
                              <li key={criterionIndex}>{criterion}</li>
                            ))}
                          </ul>
                        </>
                      )}
                    </article>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>
      </main>

      <section className="panel trace-panel bottom-log">
        <header className="panel-head">
          <h2>Planning log</h2>
          <span>{trace.length} events</span>
        </header>
        <div className="trace-log panel-scroll" ref={logRef}>
          {trace.length === 0 ? (
            <p className="empty">
              Goal Input → Planning Orchestrator → Validator → Finalizer → Presenter
              (Replanner runs only if corrections are needed)
            </p>
          ) : (
            trace.map((entry) => (
              <div key={entry.id} className={`trace-row ${entry.node}`}>
                <span className="trace-phase">{entry.node.replaceAll('_', ' ')}</span>
                <span className="trace-text">
                  <em>{entry.phase}</em> — {entry.text}
                </span>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  )
}

export default App
