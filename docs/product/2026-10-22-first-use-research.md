# First-use research and assessment

Researched October 22, 2026. This is a review of the previous changes, not another UI implementation pass.

## Scope and evidence

Aoi is a private space for two people to save memories and make plans. Relevant comparisons are relationship pairing and shared journaling, rather than retail conversion or public social feeds. A pattern earns a place when it helps someone understand sharing, complete a useful action, or recover from failure while preserving Aoi's calm tone.

Sources are official product documentation, platform guidance and published UX research. Competitor documentation establishes that a pattern is used; it does not establish that the pattern is optimal. No competitor app was physically tested and no conversion benchmarks are claimed.

## What the sources support

### Contextual learning before a tour

Apple favors short, optional onboarding and learning through actions. It recommends presenting guidance beside the relevant interface and making skipped tutorials accessible later. This supports Aoi's first-memory action and replayable help. It does not justify automatically presenting the entire tab map. [Apple onboarding guidance](https://developer.apple.com/design/human-interface-guidelines/onboarding?changes=_7)

Nielsen Norman Group describes the interaction and memory costs of instructional onboarding. Its guidance favors improving learnability and testing contextual assistance before adding separate tutorials. For Aoi, a person should be able to save a memory without recalling an introductory explanation. [NN/G mobile onboarding analysis](https://www.nngroup.com/articles/mobile-app-onboarding/)

### An invitation that remains reachable

Paired documents access to the pairing link and six-character code during setup, after the first onboarding question, and later from Home and Us. The useful lesson is that pairing remains available after its first presentation. Aoi should retain an obvious invitation destination without copying Paired's questionnaire or subscription journey. The source does not establish that an invitation control should float over every screen. [Paired pairing instructions](https://support.paired.com/en/articles/164636-how-do-i-pair-with-my-partner)

### Explicit sharing and membership

Day One describes creating a shared journal, sharing an invitation, completing membership, and then writing an entry. It provides invitation sharing in a sheet and emphasizes the distinction between personal and shared content. Aoi can use a focused invitation panel and clear audience information. Day One's group sizes, approval process and differing platform routes do not belong in Aoi merely because Day One uses them. [Day One Shared Journals](https://dayoneapp.com/guides/shared-journals/shared-journals/)

### Short, useful language

Google's communication guidance emphasizes concise language, the essential details for the current task, and a consistent voice. It also recommends testing whether people understand the words as intended. This supports explicit action labels while challenging the number of explanatory paragraphs added to Aoi's invitation and welcome sheets. [Google Material communication guidance](https://codelabs.developers.google.com/codelabs/material-communication-guidance)

Apple similarly recommends verbs for actions and links. This supports Add your first memory and Invite your partner over ambiguous action labels. It does not require removing warmth from headings or journal content. [Apple writing guidance](https://developer.apple.com/design/human-interface-guidelines/writing?changes=l_1)

Older Material onboarding documentation also describes starting in the actual interface with a useful action and optional education. It is legacy guidance, not a claim about current Material 3 component requirements. [Material Quickstart guidance](https://m1.material.io/growth-communications/onboarding.html)

## Assessment of the previous changes

### Keep

- Explicit create-versus-join choices. A second space does not connect two people, so the distinction changes the outcome.
- A visible first-memory action and an action from an empty gallery. They operate on real content rather than a disposable demonstration.
- An invitation panel with share, copy, expiry recovery and truthful membership status. Membership confirmation must come from the server, not from opening the share sheet.
- Optional help in Account and stable guidance across iPhone and Android.
- Foreground membership refresh, visible manual-check failures and protection from stale account responses. These are correctness changes. Their justification comes from Aoi's behavior and regression tests, not competitor popularity.

### Revise before treating the UI as settled

1. The automatic welcome sheet teaches all four tabs before the person has used one. Keep the guide available, but prefer an inline starting point and offer the fuller explanation on request. Waiting until the sky animation finishes prevents overlap; it does not prove that an automatic interruption is useful.
2. The invitation sheet is too wordy. Give the current status, code and primary sharing action priority. Keep the joining instructions brief and move exceptional cases such as expired links into the state where they apply.
3. The floating invitation on every tab may become a persistent reminder to finish pairing. Keep pairing easy to find, with a prominent initial invitation and a stable home in the relationship/account area. Whether it needs an ongoing cross-tab control requires observation; competitor documentation does not settle placement.
4. The Us and Memories photo paths still need a clearer relationship. Current code uses a sky-photo repository for Us and a separate memory composer/feed path. That is not proof of a bug, but a person should not need to know the implementation to predict where an added photo appears. A longer guide will not resolve an unclear content model.
5. The sky icon is a reasonable match for Us, but its comprehensibility is untested. The visible tab label carries more explanatory weight than an icon change.

These are Aoi-specific design judgments informed by the sources. They are not measured usability findings.

## The next design target

After necessary account and space setup, show the actual app with a clear way to save one memory. Make inviting the partner easy to find without requiring an invitation before the first useful action. Show saved, pending and failed states truthfully. Explain each tab when it is first useful, and retain optional help.

Aoi's shared-value acceptance criterion should be that one person saves something, the other joins and can read it, and each can identify what is shared and what to do next. This is a proposed criterion for Aoi, not an industry conversion benchmark. The owner will conduct physical testing. The research does not establish that the current build is reliable on two phones.

## Implementation outcome

The follow-up implemented optional help from Account, contextual invitations from Account and the first-memory prompt, a shorter invitation sheet, and explicit sky-versus-memory guidance. Automatic welcome presentation, the floating invitation and their unused supporting code were removed. The visible encryption and partner-sharing explanation was retained. No photo-storage migration was made. Verification and physical-test status are recorded in [first-use acceptance](first-use-acceptance.md).
