import assert from 'node:assert/strict'
import test from 'node:test'
import { analyzeWithSSE } from './api'

test('analyzeWithSSE rejects with the backend SSE error message', async () => {
  const originalFetch = globalThis.fetch
  const encoder = new TextEncoder()
  const ssePayload = 'data: {"type":"error","message":"provider boom"}\n\n'

  globalThis.fetch = (async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(ssePayload))
          controller.close()
        },
      }),
      {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }
    )) as typeof fetch

  await assert.rejects(
    () =>
      analyzeWithSSE(new Blob(['x']), {}, '', 'auto', '0123456789abcdef', {
        onError(message) {
          throw new Error(message)
        },
      }),
    /provider boom/
  )

  globalThis.fetch = originalFetch
})
