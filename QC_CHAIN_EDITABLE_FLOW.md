# QC_CHAIN_EDITABLE_FLOW

작성일: 2026-02-16 (KST)
기준 커밋: `232edc3` (기존: QA→Dev 강제 체인)
목표: **강제 체인 제거 + 사용자 편집 가능한 추천 체인**으로 전환

---

## 변경 요약 (요구사항 반영)

기존(232edc3)
- QA→Dev 체인을 강제 정규화
- 승인 시 정해진 순서로 자동 실행 중심

변경(본 수정)
1. **강제 체인 제거** → 상황 맞춤 **추천 체인** 제시
2. 승인 전 사용자가 체인 단계 **추가/삭제/순서 변경** 가능
3. 각 단계마다 **추천 이유(reason)** 표시
4. 사용자가 최종 확정한 체인만 실행
5. 자동진행 여부는 **토글(on/off)** 로 선택

---

## 신규 체인 UX/정책

### 1) 추천 체인 생성 (Suggested Chain)
- 시스템은 사용자 요청을 해석해 기본 체인 초안을 제안한다.
- 예: “QC 붙여 리뷰하고 개발자가 반영”
  - 추천 초안: `qa → developer`
  - 각 단계 reason 예시
    - qa: "요청에 리뷰/검증 의도가 포함됨"
    - developer: "리뷰 결과 반영/수정 의도가 포함됨"

### 2) 승인 전 편집 (Editable Before Confirm)
사용자는 확정 전에 다음 편집을 할 수 있다.
- 단계 추가: `+ reviewer`
- 단계 삭제: `- qa`
- 순서 변경: `developer`를 앞으로 이동

> 핵심: 시스템은 추천만 하고, **최종 실행 체인은 사용자 확정본**을 따른다.

### 3) 단계 이유 표시 (Explainability)
- 체인 미리보기에서 모든 step에 reason 필드를 노출한다.
- reason은 짧고 검증 가능한 문장으로 표기한다.
- 예시 포맷

```text
1) QA
   - reason: 리뷰/테스트 요청 키워드 감지
2) Developer
   - reason: 반영/수정 요청 키워드 감지
```

### 4) 확정 후 실행 (Execute Confirmed Chain)
- 실행 엔진은 추천안이 아닌 **사용자 확정 체인(snapshot)** 을 사용한다.
- 확정 이후에는 해당 체인 정의에 따라 step-by-step 실행한다.

### 5) 자동진행 토글 (Auto-advance Toggle)
- `autoAdvance=true`: 다음 단계 자동 시작
- `autoAdvance=false`: 단계 완료마다 사용자 확인 후 다음 단계 진행

---

## 상태 전이 규칙 (강제 → 사용자 주도)

### 이전
- PM 단계에서 QA→Dev 의도 감지 시 QA 강제 시작
- QA/Reviewer 완료 시 Developer 자동 연쇄 강제

### 변경
- 의도 감지는 "추천 근거"로만 사용
- 실제 시작 role/순서는 사용자 확정 체인에 의해 결정
- 자동 연쇄 여부도 토글값으로 제어

---

## 데이터 모델/인터페이스 권장 형태

### Chain Draft (추천/편집 단계)
- `steps: Array<{ role, reason, enabled }>`
- `autoAdvance: boolean`
- `editable: true`

### Chain Confirmed (실행 스냅샷)
- `confirmedSteps: Array<{ role, reason }>`
- `autoAdvance: boolean`
- `confirmedAt: ISO datetime`
- `sourceDraftId`

### 이벤트/메시지
- `chain_suggested`: 추천 체인 생성
- `chain_updated`: 사용자 편집 반영
- `chain_confirmed`: 최종 확정
- `chain_step_completed`: 단계 완료
- `chain_waiting_approval`: autoAdvance=false일 때 대기

---

## 수용 기준 (Acceptance Criteria)

1. 강제 체인 동작이 없어야 함
- QA→Dev 의도라도 사용자 편집 전 자동 확정/강제 실행 금지

2. 편집 가능해야 함
- 승인 전 단계 추가/삭제/순서변경이 실제 반영됨

3. 이유가 보여야 함
- 각 단계 reason이 UI/응답에 포함됨

4. 확정본 기준 실행
- 실행 로그/이벤트에 confirmed chain 기준으로 step 진행이 기록됨

5. 자동진행 토글 동작
- ON: 자동 다음 단계
- OFF: 단계마다 사용자 승인 대기

---

## 사용자 커뮤니케이션 문구 예시

- 추천 안내:
  - "요청을 바탕으로 체인을 추천했어요. 필요하면 단계 추가/삭제/순서변경 후 확정해 주세요."
- 확정 전:
  - "현재는 추천안입니다. 확정하면 이 체인으로 실행됩니다."
- 자동진행 OFF:
  - "1단계 완료. 다음 단계로 진행할까요?"

---

## 마이그레이션/호환 메모

- 기존 "QA→Dev 강제 정규화" 로직은 비활성/제거 대상
- 기존 체인 자동 안내 문구는 토글 상태를 반영하도록 수정 필요
- 회귀 테스트는 "강제" 기준에서 "추천+편집+확정" 기준으로 재정의 필요

---

## 결론

이번 수정은 체인 오케스트레이션을
- **시스템 강제형**에서
- **사용자 편집/확정 중심 추천형**으로 전환한다.

즉, 시스템은 똑똑하게 추천하고(reason 제공),
사용자는 원하는 체인을 편집/확정하며,
실행은 확정본과 자동진행 토글 설정을 정확히 따른다.
