[openclaw] CLI not found — demo mode
# AI Office QC Report (32 cases)

- Total: 32
- PASS: 32
- FAIL: 0
- Avg quality: 4.91 / 5
- Avg latency: 0.20 ms
- Agents: 3

## Matrix
|ID|Category|PASS|Concise|Quality|Latency(ms)|Input|Note|
|-|-|-|-|-|-|-|-|
|C01|단순 운영|PASS|Y|4|0.5|현재 상태 알려줘|인력 3명 · 대기 0 · 진행 0 · 완료 0입니다.|
|C02|단순 운영|PASS|Y|4|0.1|현황만 짧게|인력 3명 · 대기 0 · 진행 0 · 완료 0입니다.|
|C03|단순 운영|PASS|Y|5|0.1|대기 작업 전체 취소해줘|대기 중 작업 0건을 취소했습니다.|
|C04|단순 운영|PASS|Y|5|0.1|전체 리셋|에이전트 0명을 idle로 리셋했습니다.|
|C05|단일 산출물|PASS|Y|5|3.4|PM 1명 추가|요청 편성: pm 1명 / 승인하면 바로 적용합니다.|
|C06|단일 산출물|PASS|Y|5|0.4|개발자 1명 추가|요청 편성: developer 1명 / 승인하면 바로 적용합니다.|
|C07|복합 요청|PASS|Y|5|0.2|상태 확인하고 PM 1명 추가 제안해줘|요청 편성: pm 1명 / 승인하면 바로 적용합니다.|
|C08|엣지|PASS|Y|4|0.0|!!! 상태??|인력 3명 · 대기 0 · 진행 0 · 완료 0입니다.|
|C09|엣지|PASS|Y|5|0.3|개발자 2명, 리뷰어 1명|요청 편성: developer 2명, reviewer 1명 / 승인하면 바로 적용합니다.|
|C10|회귀|PASS|Y|5|0.1|개발자 1명|요청 편성: developer 1명 / 승인하면 바로 적용합니다.|
|C11|조건부 체인|PASS|Y|5|0.3|시장 조사 보고서 작성|pm→end, dev→end|
|C12|조건부 체인|PASS|Y|5|0.0|시장 조사 보고서 작성 후 리뷰|pm→reviewer, dev→reviewer|
|C13|조건부 체인|PASS|Y|5|0.0|웹 대시보드 구현|pm→developer, dev→end|
|C14|조건부 체인|PASS|Y|5|0.0|웹 대시보드 구현 후 QA 리뷰|pm→developer, dev→reviewer|
|C15|조건부 체인|PASS|Y|5|0.0|상태 조회 및 취소 보고|pm→end, dev→end|
|C16|단일 산출물|PASS|Y|5|0.0|리포트 정리|pm→end, dev→end|
|C17|단일 산출물|PASS|Y|5|0.0|코드 구현|pm→developer, dev→end|
|C18|복합 요청|PASS|Y|5|0.0|분석 보고서와 리뷰|pm→reviewer, dev→reviewer|
|C19|복합 요청|PASS|Y|5|0.0|API 구현 및 검토|pm→developer, dev→reviewer|
|C20|엣지|PASS|Y|5|0.0|긴급 hotfix 코드 수정|pm→developer, dev→end|
|C21|회귀|PASS|Y|5|0.1|개발자 1명 추가|developer:1|
|C22|회귀|PASS|Y|5|0.0|pm 1명|pm:1|
|C23|복합 요청|PASS|Y|5|0.0|개발자 2명 리뷰어 1명|developer:2, reviewer:1|
|C24|복합 요청|PASS|Y|5|0.1|리뷰어 2명 + qa 1명|reviewer:2, qa:1|
|C25|엣지|PASS|Y|5|0.0|  dev 3명   |developer:3|
|C26|엣지|PASS|Y|5|0.1|디자이너 2명 필요!!!|designer:2|
|C27|엣지|PASS|Y|5|0.0|1명의 개발자|developer:1|
|C28|엣지|PASS|Y|5|0.1|개발자 한명|pm:1, developer:2, reviewer:1|
|C29|엣지|PASS|Y|5|0.1|모호한 요청|pm:1, developer:2, reviewer:1|
|C30|복합 요청|PASS|Y|5|0.0|긴급 배포 인프라 qa|pm:2, developer:3, reviewer:2, devops:1, qa:1|
|C31|복합 요청|PASS|Y|5|0.0|소규모 프로토타입|pm:1, developer:1, reviewer:1|
|C32|복합 요청|PASS|Y|5|0.0|디자인 ui ux|pm:1, developer:2, reviewer:1, designer:1|

## Failed cases
- 없음
