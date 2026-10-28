import { requestChat, type ToolActivity } from './client-stream.ts'

function element(id: string): HTMLElement
function element<T extends HTMLElement>(id: string, type: new () => T): T
function element(id: string, type: new () => HTMLElement = HTMLElement) {
  const found = document.getElementById(id)
  if (!(found instanceof type)) {
    throw new Error(`Missing or invalid UI element: ${id}`)
  }
  return found
}

const form = element('chat-form', HTMLFormElement)
const message = element('message', HTMLTextAreaElement)
const send = element('send', HTMLButtonElement)
const stop = element('stop', HTMLButtonElement)
const status = element('status')
const error = element('error')
const answer = element('answer')
const toolList = element('tool-list')
const suggestions = Array.from(
  document.querySelectorAll<HTMLButtonElement>('[data-prompt]'),
)
const tools = new Map<
  string,
  {
    name: string
    summary: HTMLElement
    detail: HTMLElement
    args: string
    received: boolean
  }
>()
let controller: AbortController | undefined

function updateSend() {
  send.disabled = Boolean(controller) || message.value.trim().length === 0
}

function showTool(activity: ToolActivity) {
  let tool = tools.get(activity.id)
  if (!tool) {
    const item = document.createElement('li')
    const details = document.createElement('details')
    const summary = document.createElement('summary')
    const detail = document.createElement('pre')
    details.append(summary, detail)
    item.append(details)
    toolList.append(item)
    tool = {
      name: activity.phase === 'started' ? activity.name : 'Tool',
      summary,
      detail,
      args: '',
      received: false,
    }
    tools.set(activity.id, tool)
  }
  if (activity.phase === 'started') {
    tool.name = activity.name
  }
  if (activity.phase === 'arguments') {
    tool.args += activity.detail
  }
  if (activity.phase === 'result') {
    tool.received = true
    tool.detail.textContent = `Arguments: ${tool.args || '(not provided)'}\n\nResult: ${activity.detail}`
  } else if (!tool.received) {
    tool.detail.textContent = `Arguments: ${tool.args || '(receiving…)'}\n\nWaiting for a tool result.`
  }
  let label = 'Preparing'
  if (tool.received) {
    label = 'Result received'
  } else if (activity.phase === 'running') {
    label = 'Running'
  }
  tool.summary.textContent = `${tool.name} · ${label}`
  element('activity').hidden = false
}

message.addEventListener('input', updateSend)
message.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    if (!send.disabled) {
      form.requestSubmit()
    }
  }
})
for (const suggestion of suggestions) {
  suggestion.addEventListener('click', () => {
    message.value = suggestion.dataset.prompt ?? ''
    updateSend()
    message.focus()
  })
}
stop.addEventListener('click', () => {
  status.textContent = 'Stopping…'
  controller?.abort()
})

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  const prompt = message.value.trim()
  if (controller || !prompt || !form.reportValidity()) {
    return
  }
  controller = new AbortController()
  const signal = controller.signal
  message.readOnly = true
  stop.hidden = false
  for (const suggestion of suggestions) {
    suggestion.disabled = true
  }
  updateSend()
  element('empty-state').hidden = true
  element('run').hidden = false
  element('request-text').textContent = prompt
  element('activity').hidden = true
  tools.clear()
  toolList.replaceChildren()
  answer.textContent = ''
  element('response-area').scrollTop = 0
  error.textContent = ''
  error.hidden = true
  status.textContent = 'Working on your request…'
  try {
    const result = await requestChat(prompt, signal, {
      onText(delta) {
        answer.append(document.createTextNode(delta))
        if (status.textContent !== 'Receiving an answer…') {
          status.textContent = 'Receiving an answer…'
        }
      },
      onTool: showTool,
    })
    if (result._tag === 'Success') {
      status.textContent =
        'Run complete. The answer and tool activity are ready to read.'
      if (!answer.textContent) {
        answer.textContent =
          'The run completed without a text answer. Check any tool results above.'
      }
    } else {
      if (signal.aborted) {
        status.textContent =
          'Stopped. The answer may be incomplete. Tool actions already performed are not undone.'
      } else {
        status.textContent =
          'Run failed. Any partial answer is preserved; tool actions may already have occurred.'
        error.textContent = result.error.message
        error.hidden = false
      }
      if (!answer.textContent) {
        answer.textContent = 'No text answer was received.'
      }
    }
  } finally {
    for (const tool of tools.values()) {
      if (!tool.received) {
        tool.summary.textContent = `${tool.name} · No result reported`
        tool.detail.textContent = `Arguments: ${tool.args || '(not provided)'}\n\nNo result was received. Check reservations or events before retrying an action.`
      }
    }
    const stoppedWithFocus = document.activeElement === stop
    controller = undefined
    message.readOnly = false
    stop.hidden = true
    for (const suggestion of suggestions) {
      suggestion.disabled = false
    }
    updateSend()
    if (stoppedWithFocus) {
      message.focus()
    }
  }
})
updateSend()
