/**
 * xmp.ts — JSON-to-XMP 模板注入引擎
 *
 * 核心职责：将 AI 输出的 lightroom_params JSON 注入 BaseTemplate.xmp，
 * 生成 100% Lightroom 兼容的 .xmp 预设文件。
 *
 * 绝对禁止使用 xml2js / DOM 解析库，只用字符串模板注入。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Handlebars from 'handlebars';
import { PARAM_DEFAULTS } from '../utils/clampParams.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, '../../templates/BaseTemplate.xmp');

let compiledTemplate: ReturnType<typeof Handlebars.compile> | null = null;

/** 懒加载并编译模板（只读一次磁盘） */
function getTemplate(): ReturnType<typeof Handlebars.compile> {
    if (!compiledTemplate) {
        const raw = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
        compiledTemplate = Handlebars.compile(raw, { noEscape: true });
    }
    return compiledTemplate;
}

/** 默认的线性色调曲线（无调整） */
const DEFAULT_TONE_CURVE_SEQ = `<rdf:Seq>
      <rdf:li>0, 0</rdf:li>
      <rdf:li>255, 255</rdf:li>
    </rdf:Seq>`;

/**
 * 将 AI 输出的一维数组 [x1, y1, x2, y2, ...] 序列化为 Adobe 专用的 rdf:Seq 格式
 */
function serializeToneCurve(arr?: number[]): string {
    if (!arr || arr.length < 4 || arr.length % 2 !== 0) {
        return DEFAULT_TONE_CURVE_SEQ;
    }

    let xml = '<rdf:Seq>\n';
    for (let i = 0; i < arr.length; i += 2) {
        xml += `      <rdf:li>${arr[i]}, ${arr[i + 1]}</rdf:li>\n`;
    }
    xml += '    </rdf:Seq>';
    return xml;
}

/**
 * 将 AI 的 lightroom_params 转换为完整的 XMP 文件内容。
 *
 * @param aiParams - AI 输出的参数（已经过 clampLightroomParams 校验）
 * @returns 完整的 XMP 文件字符串
 */
export function generateXMP(aiParams: Record<string, number | number[]>): string {
    const template = getTemplate();

    // 合并默认值 + AI 参数（AI 覆盖默认值）
    const merged: Record<string, string> = {};

    // 先填默认值
    for (const [key, defaultVal] of Object.entries(PARAM_DEFAULTS)) {
        merged[key] = String(defaultVal);
    }

    // 再用 AI 参数覆盖（跳过数组类型，单独处理）
    for (const [key, value] of Object.entries(aiParams)) {
        if (!key.startsWith('ToneCurve') && typeof value === 'number') {
            merged[key] = String(value);
        }
    }

    // 特殊处理色调曲线
    merged['ToneCurvePV2012'] = serializeToneCurve(
        aiParams['ToneCurvePV2012'] as number[] | undefined
    );
    merged['ToneCurvePV2012Red'] = serializeToneCurve(
        aiParams['ToneCurvePV2012Red'] as number[] | undefined
    );
    merged['ToneCurvePV2012Green'] = serializeToneCurve(
        aiParams['ToneCurvePV2012Green'] as number[] | undefined
    );
    merged['ToneCurvePV2012Blue'] = serializeToneCurve(
        aiParams['ToneCurvePV2012Blue'] as number[] | undefined
    );

    return template(merged);
}
