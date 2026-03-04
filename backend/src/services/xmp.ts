/**
 * xmp.ts — JSON-to-XMP 模板注入引擎
 *
 * 核心职责：将 AI 输出的 lightroom_params JSON 注入 Lightroom 官方导出的标准预设模板，
 * 生成 100% Lightroom 兼容的 .xmp 预设文件。
 *
 * 绝对禁止使用 xml2js / DOM 解析库，只用字符串注入。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { PARAM_DEFAULTS } from '../utils/clampParams.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, '../../templates/LightroomPresetStandard.xmp');

let templateRaw: string | null = null;

/** 懒加载模板（只读一次磁盘） */
function getTemplateRaw(): string {
    if (!templateRaw) {
        templateRaw = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
    }
    return templateRaw;
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

function escapeRegExp(input: string): string {
    return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function setCrsAttribute(xml: string, key: string, value: string): string {
    const attrRegex = new RegExp(`crs:${escapeRegExp(key)}="[^"]*"`);
    if (attrRegex.test(xml)) {
        return xml.replace(attrRegex, `crs:${key}="${value}"`);
    }

    return xml.replace(
        /<rdf:Description([\s\S]*?)>/,
        (match, attrs: string) => `<rdf:Description${attrs}\n   crs:${key}="${value}">`
    );
}

function setNodeText(xml: string, pathTag: string, value: string): string {
    const regex = new RegExp(`(<${pathTag}[^>]*>[\\s\\S]*?<rdf:li[^>]*>)([\\s\\S]*?)(</rdf:li>)`);
    return xml.replace(regex, `$1${value}$3`);
}

function setToneCurve(xml: string, tag: string, arr?: number[]): string {
    const seq = serializeToneCurve(arr);
    const regex = new RegExp(`(<crs:${tag}>)[\\s\\S]*?(</crs:${tag}>)`);
    return xml.replace(regex, `$1\n    ${seq}\n   $2`);
}

function stripLocalMaskData(xml: string): string {
    return xml.replace(
        /<crs:MaskGroupBasedCorrections>[\s\S]*?<\/crs:MaskGroupBasedCorrections>/,
        `<crs:MaskGroupBasedCorrections>
    <rdf:Seq/>
   </crs:MaskGroupBasedCorrections>`
    );
}

function buildPresetName(): string {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `Lumina_${y}${m}${d}`;
}

/**
 * 将 AI 的 lightroom_params 转换为完整的 XMP 文件内容。
 *
 * @param aiParams - AI 输出的参数（已经过 clampLightroomParams 校验）
 * @returns 完整的 XMP 文件字符串
 */
export function generateXMP(aiParams: Record<string, number | number[]>): string {
    let xml = getTemplateRaw();
    xml = stripLocalMaskData(xml);

    const merged: Record<string, string> = {};

    for (const [key, defaultVal] of Object.entries(PARAM_DEFAULTS)) {
        merged[key] = String(defaultVal);
    }

    for (const [key, value] of Object.entries(aiParams)) {
        if (!key.startsWith('ToneCurve') && typeof value === 'number') {
            merged[key] = String(value);
        }
    }

    for (const [key, value] of Object.entries(merged)) {
        xml = setCrsAttribute(xml, key, value);
    }

    xml = setCrsAttribute(xml, 'UUID', randomUUID().replace(/-/g, '').toUpperCase());
    xml = setCrsAttribute(xml, 'HasSettings', 'True');
    xml = setNodeText(xml, 'crs:Name', buildPresetName());

    xml = setToneCurve(xml, 'ToneCurvePV2012', aiParams['ToneCurvePV2012'] as number[] | undefined);
    xml = setToneCurve(xml, 'ToneCurvePV2012Red', aiParams['ToneCurvePV2012Red'] as number[] | undefined);
    xml = setToneCurve(xml, 'ToneCurvePV2012Green', aiParams['ToneCurvePV2012Green'] as number[] | undefined);
    xml = setToneCurve(xml, 'ToneCurvePV2012Blue', aiParams['ToneCurvePV2012Blue'] as number[] | undefined);

    return xml;
}
