---
title: "LLM 에이전트의 산술 환각을 막는 결정론적 AIFunction 및 Maker-Checker 설계"
description: "감스닥(GAMSDAQ)에서 GitHub Copilot SDK 5단계 멀티 에이전트와 결정론적 C# 도구를 분리해 가격 무결성을 보장한 아키텍처 정리"
pubDate: "Nov 20 2026"
badge: "Architecture"
tags: ["Copilot-SDK", "DotNet", "Responsible-AI"]
---

금융이나 호가 거래소 도메인에 LLM 에이전트를 도입할 때 가장 큰 위험은 **산술 환각(Arithmetic Hallucination)**과 **프롬프트 인젝션(Prompt Injection)**입니다.

감스닥(GAMSDAQ)에서는 이를 해결하기 위해 역할을 명확히 분리했습니다.

1. **추론과 조율(Model Orchestration)**: `GitHub.Copilot.SDK`와 `Microsoft.Agents.AI` 기반 5개 에이전트가 고령 농가의 자연어 출하 요청을 해석하고 한국어 설명을 합성합니다.
2. **결정론적 연산(Deterministic `AIFunction`)**: 중량 환산 단가 계산(`calculate_effective_price`), 4-Gate 미끼 상품 필터링(`verify_four_gate_lowest_price`), 상생 최적 호가 산출(`compute_win_win_optimal_quote`)은 모두 C# `decimal` 기반 결정론적 함수가 수행합니다.
3. **Maker-Checker 감사 및 원자적 롤백**: 최종 감사 단계(`audit_quote_invariants`)에서는 모델이 전달한 인자보다 서버가 신뢰하는 상위 도구 실행 상태를 우선 적용(`ResolveChainedArguments`)하고, 검증 통과 전에는 격리된 작업 사본에서만 상태를 변경하여 무결성을 보장합니다.

