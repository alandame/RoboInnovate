;; RoboInnovate Project Token Contract
;; Clarity v2 (assuming latest syntax as of 2025, with traits if needed, but keeping core)
;; Implements multi-project token issuance, management, staking, vesting, governance weights, and admin controls
;; Each project has its own token metadata, supply, balances, etc., stored in maps keyed by project-id (uint)

(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-INSUFFICIENT-BALANCE u101)
(define-constant ERR-INSUFFICIENT-STAKE u102)
(define-constant ERR-MAX-SUPPLY-REACHED u103)
(define-constant ERR-PAUSED u104)
(define-constant ERR-ZERO-ADDRESS u105)
(define-constant ERR-PROJECT-NOT-FOUND u106)
(define-constant ERR-ALREADY-EXISTS u107)
(define-constant ERR-INVALID-AMOUNT u108)
(define-constant ERR-VESTING-NOT-READY u109)
(define-constant ERR-NOT-OWNER u110)

;; Global admin for the platform
(define-data-var platform-admin principal tx-sender)
(define-data-var global-paused bool false)

;; Project data structure
(define-map projects uint 
  {
    name: (string-ascii 64),
    symbol: (string-ascii 16),
    decimals: uint,
    max-supply: uint,
    total-supply: uint,
    owner: principal,
    paused: bool,
    vesting-period: uint  ;; in blocks
  }
)

;; Next project ID
(define-data-var next-project-id uint u1)

;; Balances per project: map (project-id account) => balance
(define-map balances { project-id: uint, account: principal } uint)

;; Staked balances per project
(define-map staked-balances { project-id: uint, account: principal } uint)

;; Vesting schedules: map (project-id account) => { vested-amount: uint, release-block: uint }
(define-map vesting-schedules { project-id: uint, account: principal } { vested-amount: uint, release-block: uint })

;; Private: is-platform-admin
(define-private (is-platform-admin)
  (is-eq tx-sender (var-get platform-admin))
)

;; Private: is-project-owner (project-id)
(define-private (is-project-owner (project-id uint))
  (match (map-get? projects project-id)
    some-project (is-eq tx-sender (get owner some-project))
    false
  )
)

;; Private: ensure-global-not-paused
(define-private (ensure-global-not-paused)
  (asserts! (not (var-get global-paused)) (err ERR-PAUSED))
)

;; Private: ensure-project-not-paused (project-id)
(define-private (ensure-project-not-paused (project-id uint))
  (match (map-get? projects project-id)
    some-project (asserts! (not (get paused some-project)) (err ERR-PAUSED))
    (err ERR-PROJECT-NOT-FOUND)
  )
)

;; Transfer platform admin
(define-public (transfer-platform-admin (new-admin principal))
  (begin
    (asserts! (is-platform-admin) (err ERR-NOT-AUTHORIZED))
    (asserts! (not (is-eq new-admin 'SP000000000000000000002Q6VF78)) (err ERR-ZERO-ADDRESS))  ;; burn address check
    (var-set platform-admin new-admin)
    (ok true)
  )
)

;; Set global pause
(define-public (set-global-paused (pause bool))
  (begin
    (asserts! (is-platform-admin) (err ERR-NOT-AUTHORIZED))
    (var-set global-paused pause)
    (ok pause)
  )
)

;; Create a new project
(define-public (create-project (name (string-ascii 64)) (symbol (string-ascii 16)) (decimals uint) (max-supply uint) (vesting-period uint))
  (begin
    (ensure-global-not-paused)
    (let ((project-id (var-get next-project-id)))
      (asserts! (is-none (map-get? projects project-id)) (err ERR-ALREADY-EXISTS))
      (map-set projects project-id
        {
          name: name,
          symbol: symbol,
          decimals: decimals,
          max-supply: max-supply,
          total-supply: u0,
          owner: tx-sender,
          paused: false,
          vesting-period: vesting-period
        }
      )
      (var-set next-project-id (+ project-id u1))
      (ok project-id)
    )
  )
)

;; Transfer project ownership
(define-public (transfer-project-ownership (project-id uint) (new-owner principal))
  (begin
    (ensure-global-not-paused)
    (asserts! (is-project-owner project-id) (err ERR-NOT-OWNER))
    (asserts! (not (is-eq new-owner 'SP000000000000000000002Q6VF78)) (err ERR-ZERO-ADDRESS))
    (match (map-get? projects project-id)
      some-project (map-set projects project-id (merge some-project { owner: new-owner }))
      (err ERR-PROJECT-NOT-FOUND)
    )
    (ok true)
  )
)

;; Pause/unpause a project
(define-public (set-project-paused (project-id uint) (pause bool))
  (begin
    (ensure-global-not-paused)
    (asserts! (or (is-platform-admin) (is-project-owner project-id)) (err ERR-NOT-AUTHORIZED))
    (match (map-get? projects project-id)
      some-project (map-set projects project-id (merge some-project { paused: pause }))
      (err ERR-PROJECT-NOT-FOUND)
    )
    (ok pause)
  )
)

;; Mint tokens for a project (with optional vesting)
(define-public (mint (project-id uint) (recipient principal) (amount uint) (vest bool))
  (begin
    (ensure-global-not-paused)
    (ensure-project-not-paused project-id)
    (asserts! (or (is-platform-admin) (is-project-owner project-id)) (err ERR-NOT-AUTHORIZED))
    (asserts! (not (is-eq recipient 'SP000000000000000000002Q6VF78)) (err ERR-ZERO-ADDRESS))
    (asserts! (> amount u0) (err ERR-INVALID-AMOUNT))
    (match (map-get? projects project-id)
      some-project
        (let ((new-supply (+ (get total-supply some-project) amount)))
          (asserts! (<= new-supply (get max-supply some-project)) (err ERR-MAX-SUPPLY-REACHED))
          (map-set projects project-id (merge some-project { total-supply: new-supply }))
          (if vest
            (let ((release-block (+ block-height (get vesting-period some-project))))
              (map-set vesting-schedules { project-id: project-id, account: recipient }
                { vested-amount: (+ amount (get vested-amount (default-to { vested-amount: u0, release-block: u0 } (map-get? vesting-schedules { project-id: project-id, account: recipient })))), release-block: release-block }
              )
            )
            (map-set balances { project-id: project-id, account: recipient }
              (+ amount (default-to u0 (map-get? balances { project-id: project-id, account: recipient })))
            )
          )
          (ok true)
        )
      (err ERR-PROJECT-NOT-FOUND)
    )
  )
)

;; Claim vested tokens
(define-public (claim-vested (project-id uint))
  (begin
    (ensure-global-not-paused)
    (ensure-project-not-paused project-id)
    (match (map-get? vesting-schedules { project-id: project-id, account: tx-sender })
      some-vesting
        (begin
          (asserts! (>= block-height (get release-block some-vesting)) (err ERR-VESTING-NOT-READY))
          (let ((amount (get vested-amount some-vesting)))
            (map-delete vesting-schedules { project-id: project-id, account: tx-sender })
            (map-set balances { project-id: project-id, account: tx-sender }
              (+ amount (default-to u0 (map-get? balances { project-id: project-id, account: tx-sender })))
            )
            (ok amount)
          )
        )
      (err ERR-NOT-FOUND)  ;; Assuming ERR-PROJECT-NOT-FOUND can be reused, but add if needed
    )
  )
)

;; Burn tokens
(define-public (burn (project-id uint) (amount uint))
  (begin
    (ensure-global-not-paused)
    (ensure-project-not-paused project-id)
    (asserts! (> amount u0) (err ERR-INVALID-AMOUNT))
    (match (map-get? projects project-id)
      some-project
        (let ((balance (default-to u0 (map-get? balances { project-id: project-id, account: tx-sender }))))
          (asserts! (>= balance amount) (err ERR-INSUFFICIENT-BALANCE))
          (map-set balances { project-id: project-id, account: tx-sender } (- balance amount))
          (map-set projects project-id (merge some-project { total-supply: (- (get total-supply some-project) amount) }))
          (ok true)
        )
      (err ERR-PROJECT-NOT-FOUND)
    )
  )
)

;; Transfer tokens
(define-public (transfer (project-id uint) (recipient principal) (amount uint))
  (begin
    (ensure-global-not-paused)
    (ensure-project-not-paused project-id)
    (asserts! (not (is-eq recipient 'SP000000000000000000002Q6VF78)) (err ERR-ZERO-ADDRESS))
    (asserts! (> amount u0) (err ERR-INVALID-AMOUNT))
    (let ((sender-balance (default-to u0 (map-get? balances { project-id: project-id, account: tx-sender }))))
      (asserts! (>= sender-balance amount) (err ERR-INSUFFICIENT-BALANCE))
      (map-set balances { project-id: project-id, account: tx-sender } (- sender-balance amount))
      (map-set balances { project-id: project-id, account: recipient } (+ amount (default-to u0 (map-get? balances { project-id: project-id, account: recipient }))))
      (ok true)
    )
  )
)

;; Stake tokens for governance/rewards
(define-public (stake (project-id uint) (amount uint))
  (begin
    (ensure-global-not-paused)
    (ensure-project-not-paused project-id)
    (asserts! (> amount u0) (err ERR-INVALID-AMOUNT))
    (let ((balance (default-to u0 (map-get? balances { project-id: project-id, account: tx-sender }))))
      (asserts! (>= balance amount) (err ERR-INSUFFICIENT-BALANCE))
      (map-set balances { project-id: project-id, account: tx-sender } (- balance amount))
      (map-set staked-balances { project-id: project-id, account: tx-sender } (+ amount (default-to u0 (map-get? staked-balances { project-id: project-id, account: tx-sender }))))
      (ok true)
    )
  )
)

;; Unstake tokens
(define-public (unstake (project-id uint) (amount uint))
  (begin
    (ensure-global-not-paused)
    (ensure-project-not-paused project-id)
    (asserts! (> amount u0) (err ERR-INVALID-AMOUNT))
    (let ((stake-balance (default-to u0 (map-get? staked-balances { project-id: project-id, account: tx-sender }))))
      (asserts! (>= stake-balance amount) (err ERR-INSUFFICIENT-STAKE))
      (map-set staked-balances { project-id: project-id, account: tx-sender } (- stake-balance amount))
      (map-set balances { project-id: project-id, account: tx-sender } (+ amount (default-to u0 (map-get? balances { project-id: project-id, account: tx-sender }))))
      (ok true)
    )
  )
)

;; Read-only: get project details
(define-read-only (get-project (project-id uint))
  (ok (map-get? projects project-id))
)

;; Read-only: get balance for account in project
(define-read-only (get-balance (project-id uint) (account principal))
  (ok (default-to u0 (map-get? balances { project-id: project-id, account: account })))
)

;; Read-only: get staked balance
(define-read-only (get-staked (project-id uint) (account principal))
  (ok (default-to u0 (map-get? staked-balances { project-id: project-id, account: account })))
)

;; Read-only: get vesting info
(define-read-only (get-vesting (project-id uint) (account principal))
  (ok (map-get? vesting-schedules { project-id: project-id, account: account }))
)

;; Read-only: get total supply for project
(define-read-only (get-total-supply (project-id uint))
  (match (map-get? projects project-id)
    some-project (ok (get total-supply some-project))
    (err ERR-PROJECT-NOT-FOUND)
  )
)

;; Read-only: get platform admin
(define-read-only (get-platform-admin)
  (ok (var-get platform-admin))
)

;; Read-only: is global paused
(define-read-only (is-global-paused)
  (ok (var-get global-paused))
)

;; Read-only: get next project id
(define-read-only (get-next-project-id)
  (ok (var-get next-project-id))
)