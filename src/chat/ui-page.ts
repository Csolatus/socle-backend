export const chatPage = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>Event desk · Chat</title>
  <link rel="stylesheet" href="/chat-ui.css">
  <script type="module" src="/chat-ui.js"></script>
</head>
<body>
  <a class="skip-link" href="#message">Skip to message</a>
  <div class="shell">
    <header class="header">
      <a class="brand" href="/" aria-label="Homepage"><span class="brand-mark" aria-hidden="true">e.</span> Event desk</a>
      <p class="demo-label">MCP + AI playground</p>
    </header>
    <main class="layout">
      <section class="intro" aria-labelledby="title">
        <p class="eyebrow">Your plans, a little simpler.</p>
        <h1 id="title">Good events.<br> Less admin.</h1>
        <p class="intro-copy">Find an event, check your reservations, or make a plan. Ask the assistant to take care of the details.</p>
        <div class="identity">
          <div class="identity-heading"><span class="avatar" aria-hidden="true">A</span><div><strong>Chatting as Alice</strong><p>Seeded demo identity</p></div></div>
          <p>This demo sends Alice’s user ID, not a login. Tool actions can change real demo data.</p>
        </div>
        <section class="suggestions" aria-labelledby="suggestions-title">
          <h2 id="suggestions-title">Start with a question</h2>
          <button type="button" data-prompt="List the upcoming events and show their IDs.">Explore upcoming events <span aria-hidden="true">↗</span></button>
          <button type="button" data-prompt="Show my reservations, including the event and reservation IDs.">Check my reservations <span aria-hidden="true">↗</span></button>
          <button type="button" data-prompt="Find upcoming gaming events and show their availability.">Find a gaming event <span aria-hidden="true">↗</span></button>
        </section>
        <p class="model-note">OpenRouter · z-ai/glm-5.3-flash<br>Tools connected through MCP.</p>
      </section>
      <section class="workspace" aria-labelledby="workspace-title">
        <div class="workspace-header"><h2 id="workspace-title">Ask the event desk</h2><span class="turn-label">Single turn</span></div>
        <div id="response-area" class="response-area" role="region" aria-label="Chat response and tool activity" tabindex="0">
          <div id="empty-state" class="empty-state"><div class="empty-mark" aria-hidden="true">e.</div><h3>A good plan starts here</h3><p>Ask about events or your reservations.<br>Live answers and tool activity appear here.</p></div>
          <div id="run" hidden>
            <p class="response-label">Your request</p><p id="request-text" class="request-text"></p>
            <div id="activity" class="activity" hidden><h3>Tool activity</h3><ol id="tool-list" role="list"></ol></div>
            <h3 class="response-label">Assistant</h3>
            <div id="answer" class="answer" aria-label="Assistant response"></div>
          </div>
        </div>
        <div class="composer">
          <p id="status" class="status" role="status" aria-live="polite" aria-atomic="true">Ready when you are.</p>
          <p id="error" class="error" role="alert" hidden></p>
          <form id="chat-form">
            <label for="message">Message</label>
            <textarea id="message" name="message" rows="3" maxlength="4000" required placeholder="What would you like to plan?" aria-describedby="turn-note keyboard-note"></textarea>
            <div class="composer-actions"><p id="keyboard-note">Enter to send · Shift + Enter for a new line</p><div class="buttons"><button id="stop" type="button" hidden>Stop</button><button id="send" type="submit" disabled>Send message <span aria-hidden="true">↑</span></button></div></div>
          </form>
          <p id="turn-note" class="turn-note">Every message starts a fresh run. No chat history is sent; the previous answer is replaced. Check tool results before repeating an action.</p>
        </div>
      </section>
    </main>
    <noscript><p class="noscript">JavaScript is needed for live chat. You can still use the POST /chat API.</p></noscript>
  </div>
</body>
</html>`
