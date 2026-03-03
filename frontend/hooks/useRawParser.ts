/**
 * useRawParser.ts
 *
 * React Hook：封装 Web Worker 与 WASM 通信，供组件调用。
 *
 * 用法：
 *   const { parse, state, result, error } = useRawParser();
 *
 *   <input type="file" onChange={e => parse(e.target.files[0])} />
 *   {state === 'done' && <p>{result.exif.camera_model}</p>}
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RawAnalysisResult } from '@/workers/raw-parser.worker';

export type ParseState = 'idle' | 'parsing' | 'done' | 'error';

export interface ParseProgress {
    stage: string;
    pct: number;
}

export interface UseRawParserReturn {
    /** 解析一个 File 对象（NEF/CR2/ARW/JPG 等） */
    parse: (file: File) => void;
    /** 当前状态机状态 */
    state: ParseState;
    /** 解析进度（仅 parsing 阶段有效） */
    progress: ParseProgress | null;
    /** 解析结果（仅 state === 'done' 时有效） */
    result: RawAnalysisResult | null;
    /** 错误信息（仅 state === 'error' 时有效） */
    error: string | null;
    /** 是否已完成 WASM 可用性探测 */
    wasmChecked: boolean;
    /** WASM 产物是否可用 */
    wasmAvailable: boolean;
    /** 重置到初始状态 */
    reset: () => void;
}

export function useRawParser(): UseRawParserReturn {
    const workerRef = useRef<Worker | null>(null);
    const [state, setState] = useState<ParseState>('idle');
    const [progress, setProgress] = useState<ParseProgress | null>(null);
    const [result, setResult] = useState<RawAnalysisResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [wasmChecked, setWasmChecked] = useState(false);
    const [wasmAvailable, setWasmAvailable] = useState(false);

    // ── Worker 懒创建（组件挂载时初始化，卸载时销毁） ─────────────────────────
    useEffect(() => {
        // 预检查 WASM 产物是否存在（用于前端禁用 NEF 链路）
        fetch('/wasm/raw_analyzer.js', { method: 'HEAD', cache: 'no-store' })
            .then((res) => {
                setWasmAvailable(res.ok);
                setWasmChecked(true);
                if (!res.ok) {
                    setError('未找到 /wasm/raw_analyzer.js，请先执行 frontend/wasm/build.sh');
                }
            })
            .catch(() => {
                setWasmAvailable(false);
                setWasmChecked(true);
                setError('WASM 检查失败，请确认 /public/wasm/raw_analyzer.js 已生成');
            });

        workerRef.current = new Worker(
            new URL('../workers/raw-parser.worker.ts', import.meta.url),
            { type: 'module' }
        );

        workerRef.current.onmessage = (event: MessageEvent) => {
            const { type, stage, pct, result: r, message } = event.data;

            if (type === 'PROGRESS') {
                setProgress({ stage, pct });
                return;
            }
            if (type === 'DONE') {
                setResult(r as RawAnalysisResult);
                setProgress(null);
                setState('done');
                return;
            }
            if (type === 'ERROR') {
                setError(message as string);
                setProgress(null);
                setState('error');
            }
        };

        workerRef.current.onerror = (e) => {
            setError(`Worker 崩溃: ${e.message}`);
            setState('error');
        };

        return () => {
            workerRef.current?.terminate();
            workerRef.current = null;
        };
    }, []);

    const parse = useCallback((file: File) => {
        if (!workerRef.current) return;
        if (wasmChecked && !wasmAvailable) {
            setResult(null);
            setProgress(null);
            setState('error');
            setError('NEF 解析不可用：缺少 /wasm/raw_analyzer.js，请先执行 frontend/wasm/build.sh');
            return;
        }

        // 重置状态
        setResult(null);
        setError(null);
        setProgress({ stage: '准备中...', pct: 0 });
        setState('parsing');

        // 读取文件为 ArrayBuffer，用 Transferable 零拷贝传给 Worker
        file.arrayBuffer().then((buffer) => {
            workerRef.current!.postMessage(
                { type: 'PARSE', buffer },
                [buffer]  // ← Transferable，ArrayBuffer 所有权转移，主线程清零，节省内存
            );
        }).catch((err) => {
            setError(`文件读取失败: ${String(err)}`);
            setState('error');
        });
    }, [wasmAvailable, wasmChecked]);

    const reset = useCallback(() => {
        setResult(null);
        setError(null);
        setProgress(null);
        setState('idle');
    }, []);

    return { parse, state, progress, result, error, wasmChecked, wasmAvailable, reset };
}
