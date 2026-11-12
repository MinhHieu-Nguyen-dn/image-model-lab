/** Unit tests: endpoint normalisation, chip compilation, payload order, masking, effective auth, image headers. */
import { describe, expect, test } from "bun:test";
import { GENERATION_PATH, normaliseEndpoint } from "../src/server/endpoint-normalisation.ts";
import { compilePrompt } from "../src/server/prompt-compiler.ts";
import { buildBody, planModel, type GenerationInputs } from "../src/server/upstream-payload-builder.ts";
import { DEFAULT_CATALOG } from "../src/server/catalog-store.ts";
import { maskKey, resolveEffective, reusableKey } from "../src/server/model-studio-auth-store.ts";
import { readImageInfo } from "../src/server/image-meta.ts";
import { validateSize } from "../src/server/generation-params-validation.ts";
import { pngBytes } from "./helpers/test-harness.ts";

describe("endpoint normalisation", () => {
  test("bare ws- host gets https and the generation path", () => {
    expect(normaliseEndpoint("ws-abc123.ap-southeast-1.maas.aliyuncs.com")).toBe(
      `https://ws-abc123.ap-southeast-1.maas.aliyuncs.com${GENERATION_PATH}`,
    );
  });
  test("host with scheme and trailing slash", () => {
    expect(normaliseEndpoint("https://ws-x.ap-southeast-1.maas.aliyuncs.com/")).toBe(`https://ws-x.ap-southeast-1.maas.aliyuncs.com${GENERATION_PATH}`);
  });
  test("full URL containing /api/ is kept", () => {
    const url = "https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";
    expect(normaliseEndpoint(url)).toBe(url);
  });
  test("SDK-style base URLs (/api/v1, /compatible-mode/v1) are completed with the generation path", () => {
    const host = "https://ws-x.ap-southeast-1.maas.aliyuncs.com";
    const want = `${host}${GENERATION_PATH}`;
    expect(normaliseEndpoint(`${host}/api/v1`)).toBe(want);
    expect(normaliseEndpoint(`${host}/api/v1/`)).toBe(want);
    expect(normaliseEndpoint(`${host}/compatible-mode/v1`)).toBe(want);
    expect(normaliseEndpoint("ws-x.ap-southeast-1.maas.aliyuncs.com/api/v1")).toBe(want);
  });
  test("normalising is idempotent", () => {
    const once = normaliseEndpoint("https://ws-x.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1");
    expect(normaliseEndpoint(once)).toBe(once);
  });
  test("rejects garbage and non-http schemes", () => {
    expect(() => normaliseEndpoint("")).toThrow();
    expect(() => normaliseEndpoint("ftp://host")).toThrow();
  });
});

describe("prompt compiler", () => {
  const prompt = "Replace the face of the character in {{ref:A}} with the face of the character in {{ref:B}}";
  test("face swap compiles to image 1 -> image 2", () => {
    expect(compilePrompt(prompt, ["A", "B"], "image {n}").text).toBe(
      "Replace the face of the character in image 1 with the face of the character in image 2",
    );
  });
  test("reorder renumbers chips", () => {
    const out = compilePrompt(prompt, ["B", "A"], "image {n}");
    expect(out.text).toBe("Replace the face of the character in image 2 with the face of the character in image 1");
    expect(out.refOrder).toEqual(["B", "A"]);
  });
  test("custom template and repeated chips", () => {
    expect(compilePrompt("{{ref:A}} and {{ref:A}}", ["A"], "Picture {n}").text).toBe("Picture 1 and Picture 1");
  });
  test("dangling chip errors", () => {
    expect(() => compilePrompt("x {{ref:GONE}}", ["A"], "image {n}")).toThrow(/deleted reference/);
  });
});

describe("payload builder", () => {
  const inputs: GenerationInputs = {
    compiledText: "swap image 1 and image 2", negativePrompt: "blurry", size: "1024*1024", n: 2, seed: 7, promptExtend: true,
    refs: [{ id: "a", order: 1, filename: "a.png", bytes: 10 }, { id: "b", order: 2, filename: "b.png", bytes: 20 }],
  };
  const [m30, , m21] = DEFAULT_CATALOG.models;
  test("images in order then exactly one text", () => {
    const { body } = buildBody(m30, inputs, ["data:1", "data:2"]);
    expect(body.input.messages[0].content).toEqual([{ image: "data:1" }, { image: "data:2" }, { text: "swap image 1 and image 2" }]);
    expect(body.parameters).toEqual({ size: "1024*1024", n: 2, seed: 7, negative_prompt: "blurry", prompt_extend: true, watermark: false });
  });
  test("negative prompt omitted and reported when unsupported", () => {
    const { body, omittedParams } = buildBody(m21, inputs, []);
    expect(body.parameters.negative_prompt).toBeUndefined();
    expect(omittedParams).toEqual(["negative_prompt"]);
  });
  test("seed omitted when null", () => {
    expect(buildBody(m30, { ...inputs, seed: null }, []).body.parameters.seed).toBeUndefined();
  });
  test("over-limit refs fail the plan with a clear message", () => {
    const refs = Array.from({ length: 4 }, (_, i) => ({ id: `r${i}`, order: i + 1, filename: `${i}.png`, bytes: 1 }));
    const plan = planModel(m30, { ...inputs, refs });
    expect(plan.ok).toBe(false);
    expect(plan.error).toContain("at most 3");
    expect(planModel(m21, { ...inputs, refs }).ok).toBe(true);
  });
});

describe("auth helpers", () => {
  test("mask shows prefix and last 4 only", () => {
    expect(maskKey("sk-0123456789abcdef9f3a")).toBe("sk-****9f3a");
    expect(maskKey("short")).toBe("****");
  });
  test("effective: project override wins over global, else global", () => {
    const g = "https://ws-a.ap-southeast-1.maas.aliyuncs.com/api/v1/x";
    const file = {
      global: { endpoint: g, apiKey: "gk" },
      projects: {
        p1: { endpoint: "https://p.example/api", apiKey: "pk" },
        same: { endpoint: "https://ws-a.ap-southeast-1.maas.aliyuncs.com/other", apiKey: "" },
        other: { endpoint: "https://ws-b.ap-southeast-1.maas.aliyuncs.com/api", apiKey: "" },
      },
    };
    expect(resolveEffective(file, "p1")).toEqual({ endpoint: "https://p.example/api", apiKey: "pk", source: "project" });
    // A key-less override reuses the global key only on the same origin; never on a different host.
    expect(resolveEffective(file, "same")?.apiKey).toBe("gk");
    expect(resolveEffective(file, "other")?.apiKey).toBe("");
    expect(resolveEffective(file, "none")).toEqual({ endpoint: g, apiKey: "gk", source: "global" });
    expect(resolveEffective({ global: null, projects: {} }, "x")).toBeNull();
  });
  test("reusableKey / sameOrigin", () => {
    const stored = { endpoint: "https://a.example:8443/x", apiKey: "k" };
    expect(reusableKey("https://a.example:8443/other", stored)).toBe("k");
    expect(reusableKey("https://a.example/other", stored)).toBeUndefined();
    expect(reusableKey("http://a.example:8443/x", stored)).toBeUndefined();
    expect(reusableKey("not a url", stored)).toBeUndefined();
    expect(reusableKey("https://a.example:8443", null)).toBeUndefined();
  });
  test("mask never reveals most of a short key", () => {
    expect(maskKey("0123456789")).toBe("****6789");
    expect(maskKey("012345678901234567")).toBe("****4567");
    expect(maskKey("")).toBe("");
  });
});

describe("validation and image headers", () => {
  test("size limits", () => {
    expect(validateSize("1024*1024")).toBe("1024*1024");
    expect(() => validateSize("256*256")).toThrow();
    expect(() => validateSize("4096*4096")).toThrow();
    expect(() => validateSize("2048*200")).toThrow();
    expect(() => validateSize("1024x1024")).toThrow();
  });
  test("PNG dimensions", () => {
    expect(readImageInfo(pngBytes(300, 200))).toEqual({ format: "png", width: 300, height: 200 });
  });
});
