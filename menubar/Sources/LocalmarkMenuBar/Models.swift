import Foundation

struct PlatformSettings: Codable {
    var enabled: Bool
    var account: String
    var browser: String
    var intervalSeconds: Int
    var surfaces: [String: Bool]
}

struct Platforms: Codable {
    var x: PlatformSettings
    var threads: PlatformSettings
}

struct LocalmarkSettings: Codable {
    var version: Int
    var autoSync: Bool
    var platforms: Platforms
}

struct PlatformState: Codable {
    var lastSuccess: String?
    var lastError: String?
}

struct SyncState: Codable {
    var version: Int
    var platforms: [String: PlatformState]
}

struct BrowserCapability: Codable {
    var id: String
    var label: String
}

struct SurfaceCapability: Codable {
    var key: String
    var label: String
    var supported: Bool
    var unavailableReason: String?
}

struct PlatformCapability: Codable {
    var browsers: [BrowserCapability]
    var supportsAccountVerification: Bool
    var supportsScheduledCollection: Bool
    var surfaces: [SurfaceCapability]
}

struct PlatformCapabilities: Codable {
    var x: PlatformCapability
    var threads: PlatformCapability
}

struct QmdStatus: Codable {
    var installed: Bool
    var enabled: Bool
    var indexed: Bool
    var available: Bool

    var label: String {
        if !installed { return "QMD: 미설치" }
        if !enabled { return "QMD: 꺼짐" }
        if !indexed { return "QMD: 인덱스 없음" }
        return "QMD 검색: 사용 가능"
    }
}

struct StatusSnapshot: Codable {
    var dataDir: String
    var settings: LocalmarkSettings
    var state: SyncState
    var capabilities: PlatformCapabilities
    var qmd: QmdStatus
}

struct ProcessResult {
    let status: Int32
    let stdout: String
    let stderr: String
}

enum AccountCheckStatus {
    case checking
    case verified
    case mismatch
    case loginRequired
    case failed
}

struct AccountCheck {
    var expected: String
    var detected: String?
    var status: AccountCheckStatus
    var message: String?
}

enum CoreError: LocalizedError {
    case missingRuntime(String)
    case commandFailed(String)

    var errorDescription: String? {
        switch self {
        case .missingRuntime(let message), .commandFailed(let message): return message
        }
    }
}
