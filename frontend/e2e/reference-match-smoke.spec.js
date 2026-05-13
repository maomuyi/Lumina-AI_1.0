const { expect, test } = require('@playwright/test')

function sseEvent(event) {
  return `data: ${JSON.stringify(event)}\n\n`
}

async function uploadCanvasFile(page, inputIndex, fileName, mimeType, colors) {
  await page.evaluate(
    async ({ inputIndex, fileName, mimeType, colors }) => {
      const input = document.querySelectorAll('input[type="file"]')[inputIndex]
      if (!input) throw new Error(`Missing file input ${inputIndex}`)

      const canvas = document.createElement('canvas')
      canvas.width = 64
      canvas.height = 64
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Missing canvas context')

      const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height)
      gradient.addColorStop(0, colors[0])
      gradient.addColorStop(1, colors[1])
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, mimeType, 0.92))
      if (!blob) throw new Error('Canvas export failed')

      const file = new File([blob], fileName, { type: mimeType })
      const dataTransfer = new DataTransfer()
      dataTransfer.items.add(file)
      input.files = dataTransfer.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
    },
    { inputIndex, fileName, mimeType, colors }
  )
}

test('uploads target and reference images, adjusts strength, and generates a reference-match XMP', async ({ page }) => {
  let analyzeRequestCount = 0
  let xmpRequestCount = 0
  let xmpPayload = null

  await page.route('**/api/analyze', async (route) => {
    analyzeRequestCount += 1
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
      },
      body:
        sseEvent({
          type: 'progress',
          stage: 'local_rules_start',
          message: '本地规则引擎已接管',
          progress: 45,
        }) +
        sseEvent({
          type: 'final',
          session_id: 'smoke-session',
          assistant_summary: '已生成初始调色方案',
          scene_label: 'smoke',
          quick_chips: ['高光再压一点', '整体更自然'],
          diagnostic_report: {
            module_1_diagnosis: '【画面诊断】测试照片具备稳定可调空间。',
            module_2_physics: '【底层剖析】JPG 参考级分析，亮暗部风险较低。',
            module_3_strategy: '【美化建议】保守提升白平衡、层次与色彩。',
            module_4_core_actions: [
              '【Temperature】5200: 维持自然白平衡',
              '【Vibrance】12: 轻微提升色彩活力',
            ],
          },
          lightroom_params: {
            Temperature: 5200,
            Tint: 0,
            Exposure2012: 0,
            Contrast2012: 8,
            Highlights2012: -12,
            Shadows2012: 10,
            Whites2012: 4,
            Blacks2012: -6,
            Vibrance: 12,
            Saturation: 0,
          },
          download_url: '/downloads/smoke-initial.xmp',
        }),
    })
  })

  await page.route('**/api/xmp', async (route) => {
    xmpRequestCount += 1
    xmpPayload = route.request().postDataJSON()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ download_url: '/downloads/smoke-reference.xmp' }),
    })
  })

  await page.goto('/')

  await uploadCanvasFile(page, 0, 'target.jpg', 'image/jpeg', ['#24324f', '#7f8a96'])
  await expect(page.getByTitle('target.jpg')).toBeVisible()

  await uploadCanvasFile(page, 1, 'reference.png', 'image/png', ['#f8a22d', '#fff1b8'])
  await expect(page.getByText('本地追色已就绪')).toBeVisible()

  const strengthSlider = page.locator('input[type="range"]')
  await expect(strengthSlider).toBeEnabled()
  await strengthSlider.fill('50')
  await expect(strengthSlider).toHaveValue('50')

  await page.getByRole('button', { name: /生成初始调色方案/ }).click()

  await expect(page.getByRole('button', { name: /调色助手/ })).toBeVisible()
  await expect(page.locator('span').filter({ hasText: /^参考图追色 50%$/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /下载当前版/ })).toBeVisible()

  expect(analyzeRequestCount).toBe(1)
  expect(xmpRequestCount).toBeGreaterThanOrEqual(1)
  expect(xmpPayload).toMatchObject({ session_id: 'smoke-session' })
  expect(Object.keys(xmpPayload.lightroom_params).length).toBeGreaterThan(0)
})

test('tone assistant chat supports explain, refine, narrow layout, and failure guard', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 860 })

  let refineRequestCount = 0

  await page.route('**/api/analyze', async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
      },
      body: sseEvent({
        type: 'final',
        session_id: 'timeline-session',
        assistant_summary: '初始方案已生成',
        scene_label: 'timeline-smoke',
        quick_chips: ['高光再压一点', '暗部更通透'],
        diagnostic_report: {
          module_1_diagnosis: '【画面诊断】V1 初始诊断。',
          module_2_physics: '【底层剖析】V1 底层分析。',
          module_3_strategy: '【美化建议】V1 参数策略。',
          module_4_core_actions: [
            '【Temperature】5200: 初始白平衡',
            '【Vibrance】12: 初始色彩',
          ],
        },
        lightroom_params: {
          Temperature: 5200,
          Tint: 0,
          Exposure2012: 0,
          Contrast2012: 8,
          Highlights2012: -12,
          Shadows2012: 10,
          Whites2012: 4,
          Blacks2012: -6,
          Vibrance: 12,
          Saturation: 0,
        },
        download_url: '/downloads/timeline-v1.xmp',
      }),
    })
  })

  await page.route('**/api/refine', async (route) => {
    refineRequestCount += 1

    if (refineRequestCount === 3) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'mock refine failure' }),
      })
      return
    }

    await new Promise((resolve) => setTimeout(resolve, 120))
    const version = refineRequestCount + 1
    const temp = version === 2 ? 4800 : 4550
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
      },
      body: sseEvent({
        type: 'progress',
        stage: 'llm_refine',
        message: `正在生成 V${version} 调色参数`,
        progress: 45,
      }) + sseEvent({
        type: 'final',
        session_id: 'timeline-session',
        assistant_summary: `V${version} 成功生成一段非常长但应该被稳定截断的调色助手摘要`,
        changed_params: [
          { key: 'Temperature', before: version === 2 ? 5200 : 4800, after: temp },
          { key: 'Tint', before: 0, after: version === 2 ? 8 : 12 },
          { key: 'Contrast2012', before: 8, after: version === 2 ? 16 : 22 },
          { key: 'Highlights2012', before: -12, after: version === 2 ? -26 : -34 },
          { key: 'SaturationAdjustmentBlue', before: 0, after: version === 2 ? 24 : 32 },
        ],
        report_summary: `V${version} 专属诊断摘要`,
        scene_label: 'timeline-smoke',
        quick_chips: ['整体更自然', '对比强一点'],
        diagnostic_report: {
          module_1_diagnosis: `【画面诊断】V${version} 专属完整诊断。`,
          module_2_physics: `【底层剖析】V${version} 底层分析。`,
          module_3_strategy: `【美化建议】V${version} 参数策略。`,
          module_4_core_actions: [
            `【Temperature】${temp}: V${version} 白平衡`,
            `【Contrast2012】${version === 2 ? 16 : 22}: V${version} 对比`,
          ],
        },
        lightroom_params: {
          Temperature: temp,
          Tint: version === 2 ? 8 : 12,
          Exposure2012: 0,
          Contrast2012: version === 2 ? 16 : 22,
          Highlights2012: version === 2 ? -26 : -34,
          Shadows2012: 18,
          Whites2012: 6,
          Blacks2012: -10,
          Vibrance: 18,
          Saturation: 0,
          SaturationAdjustmentBlue: version === 2 ? 24 : 32,
        },
        download_url: `/downloads/timeline-v${version}.xmp`,
      }),
    })
  })

  await page.goto('/')
  await uploadCanvasFile(page, 0, 'timeline-target.jpg', 'image/jpeg', ['#25304d', '#b2beca'])
  await page.getByRole('button', { name: /生成初始调色方案/ }).click()
  await expect(page.getByRole('button', { name: /调色助手/ })).toBeVisible()
  await expect(page.getByText('Chat')).toHaveCount(0)
  await expect(page.getByTestId('v1-diagnostic-card')).toBeVisible()
  await expect(page.getByTestId('v1-diagnostic-card')).toBeInViewport()
  await expect(page.getByTestId('v1-diagnostic-sequence')).toContainText('V1 诊断')
  await expect(page.getByTestId('v1-score-hero')).toBeVisible()
  await expect(page.getByTestId('v1-score-hero')).toContainText('底片可调潜力')
  await expect(page.getByTestId('v1-score-hero')).toContainText('底片可调潜力，不是审美评分')
  await expect(page.getByTestId('v1-score-hero')).toContainText('可信诊断')
  await expect(page.getByTestId('assistant-chat-thread')).toContainText('V1 初始调色诊断')
  await expect(page.getByTestId('assistant-chat-thread')).toContainText('这张图的调色起点')
  await expect(page.getByTestId('assistant-chat-thread')).toContainText('V1 的处理策略')
  await expect(page.getByTestId('assistant-chat-thread')).toContainText('关键动作')
  await expect(page.getByTestId('assistant-chat-thread')).toContainText('我会特别留意')
  await expect(page.getByTestId('v1-diagnostic-expanded')).toBeVisible()
  await expect(page.getByTestId('assistant-chat-thread')).not.toContainText('我已经为这张照片生成了 V1')
  await expect(page.getByRole('button', { name: /查看参数/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /下载此版/ })).toBeVisible()

  const refineInput = page.getByPlaceholder('问我这版为什么这样调，或告诉我下一步想怎么改...')
  await refineInput.fill('为什么要压高光？')
  await refineInput.press('Enter')
  await expect(page.getByTestId('v1-diagnostic-collapsed')).toBeVisible()
  await expect(page.getByTestId('v1-diagnostic-collapsed')).toContainText(/\d{2}/)
  await expect(page.getByRole('button', { name: /展开 V1 诊断/ })).toBeVisible()
  await expect(page.getByTestId('assistant-chat-thread')).toContainText('我压高光主要是为了保住最亮区域的层次')
  await expect(page.getByTestId('assistant-chat-bottom')).toBeInViewport()
  expect(refineRequestCount).toBe(0)
  await expect(page.getByText('V2')).toHaveCount(0)
  await page.getByRole('button', { name: /展开 V1 诊断/ }).click()
  await expect(page.getByTestId('v1-diagnostic-expanded')).toBeVisible()
  await page.getByRole('button', { name: /^收起$/ }).click()
  await expect(page.getByTestId('v1-diagnostic-collapsed')).toBeVisible()

  await refineInput.fill('冷一点，蓝色更明显')
  const firstRefineResponse = page.waitForResponse('**/api/refine')
  await refineInput.press('Enter')
  await expect(page.getByTestId('assistant-run-status')).toContainText('正在生成 V2')
  await expect(page.getByTestId('user-message').filter({ hasText: '冷一点，蓝色更明显' })).toBeVisible()
  await expect(page.getByText(/分析引擎正在根据/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: /重新生成 V1/ })).toBeVisible()
  await firstRefineResponse
  await expect(page.getByText(/V2 成功生成/)).toBeVisible()
  await expect(page.getByTestId('v1-diagnostic-collapsed')).toBeVisible()
  await expect(page.locator('[data-version-id="V2"]')).toContainText('色温')
  await page.locator('[data-version-id="V2"]').getByRole('button', { name: /查看参数/ }).click()
  await expect(page.getByRole('button', { name: /参数面板/ })).toHaveClass(/text-primary/)
  await page.getByRole('button', { name: /调色助手/ }).click()

  await refineInput.fill('再压高光并增强蓝色')
  await refineInput.press('Enter')
  await expect(page.getByText(/V3 成功生成/)).toBeVisible()
  await expect(page.getByTestId('assistant-chat-bottom')).toBeInViewport()

  const thread = page.getByTestId('assistant-chat-thread')
  const screenshot = await thread.screenshot()
  expect(screenshot.length).toBeGreaterThan(1000)

  const overflowing = await page.getByTestId('assistant-message').evaluateAll((messages) =>
    messages.flatMap((message) => {
      const elements = [message, ...message.querySelectorAll('button, span')]
      return elements
        .filter((element) => element.scrollWidth > element.clientWidth + 1)
        .map((element) => element.textContent?.trim() || element.tagName)
    })
  )
  expect(overflowing).toEqual([])

  await page.locator('[data-version-id="V3"]').getByRole('button', { name: /上一版/ }).click()
  await expect(page.getByText('当前 V2')).toBeVisible()
  await expect(page.getByRole('button', { name: /下载当前版/ })).toBeVisible()

  await refineInput.fill('这次接口失败')
  await refineInput.press('Enter')
  await expect(page.getByTestId('assistant-run-status')).toContainText('微调失败，当前版本未被覆盖')
  await expect(page.getByText('当前 V2')).toBeVisible()
  await expect(page.getByText('V4')).toHaveCount(0)
  await expect(page.getByText(/分析引擎正在根据/)).toHaveCount(0)
  await expect(refineInput).toHaveValue('这次接口失败')
})
