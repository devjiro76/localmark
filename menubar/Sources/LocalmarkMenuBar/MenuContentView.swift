import AppKit
import SwiftUI

struct MenuContentView: View {
    @EnvironmentObject private var model: AppModel
    private let intervals = [(1800, "30분"), (3600, "1시간"), (10800, "3시간"), (21600, "6시간"), (43200, "12시간"), (86400, "24시간")]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label("Localmark", systemImage: "bookmark.fill").font(.headline)
                Spacer()
                if model.busy || model.running { ProgressView().controlSize(.small) }
            }

            if let settings = Binding($model.settings) {
                HStack {
                    Toggle("자동 수집", isOn: settings.autoSync)
                        .onChange(of: settings.wrappedValue.autoSync) { _ in model.update() }
                    Spacer()
                    Button("지금 수집", action: model.runNow).disabled(model.running || model.saving)
                    Button("새로고침", action: model.refresh).disabled(model.running || model.saving)
                }

                platformSection(title: "X", platform: "x", settings: settings.platforms.x)
                Divider()
                platformSection(title: "Threads", platform: "threads", settings: settings.platforms.threads)
            } else {
                Text("설정을 불러오는 중입니다…").foregroundStyle(.secondary)
            }

            Divider()
            VStack(alignment: .leading, spacing: 5) {
                HStack {
                    Text("데이터 경로").font(.subheadline).fontWeight(.semibold)
                    Spacer()
                    Button("위치 변경", action: model.chooseDataDirectory).controlSize(.small)
                    Button("경로 열기", action: model.openDataDirectory).controlSize(.small)
                }
                Text(model.dataDirectory).font(.caption).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
            }

            if let notice = model.notice { Text(notice).font(.caption).foregroundStyle(.green) }
            if let error = model.errorMessage { Text(error).font(.caption).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true) }

            Divider()
            HStack {
                Text(model.qmdStatus?.label ?? "QMD 상태 확인 중…").font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button("종료") { NSApplication.shared.terminate(nil) }
            }
        }
        .padding(14)
        .frame(width: 400)
    }

    private func platformSection(title: String, platform: String, settings: Binding<PlatformSettings>) -> some View {
        let capability = model.capability(for: platform)
        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                Toggle("\(title) 수집", isOn: settings.enabled)
                    .onChange(of: settings.wrappedValue.enabled) { _ in model.update() }
                Spacer()
                Picker("수집 주기", selection: settings.intervalSeconds) {
                    ForEach(intervals, id: \.0) { Text($0.1).tag($0.0) }
                }
                .labelsHidden()
                .frame(width: 86)
                .disabled(capability?.supportsScheduledCollection == false)
                .onChange(of: settings.wrappedValue.intervalSeconds) { _ in model.update() }
            }

            accountRow(platform: platform, settings: settings, capability: capability)

            if let capability {
                surfaceChips(settings: settings, surfaces: capability.surfaces)
            } else {
                Text("지원 항목을 불러오는 중입니다…").font(.caption).foregroundStyle(.secondary)
            }

            if let state = model.state(for: platform) {
                VStack(alignment: .leading, spacing: 3) {
                    if let success = state.lastSuccess {
                        Text("마지막 수집: \(formattedDate(success))").font(.caption).foregroundStyle(.secondary)
                    }
                    if let error = state.lastError {
                        Text(error).font(.caption).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func accountRow(platform: String, settings: Binding<PlatformSettings>, capability: PlatformCapability?) -> some View {
        let check = model.accountCheck(for: platform)
        HStack(spacing: 6) {
            Text("계정").font(.caption).foregroundStyle(.secondary)

            if settings.account.wrappedValue.isEmpty {
                Text("첫 수집 후 자동 감지").font(.caption).foregroundStyle(.secondary)
            } else {
                Text("@\(settings.account.wrappedValue)").font(.caption)
            }

            accountStatusIcon(check)

            Spacer()

            if let browsers = capability?.browsers {
                Picker(selection: settings.browser) {
                    ForEach(browsers, id: \.id) { browser in
                        Text(browser.label).tag(browser.id)
                    }
                } label: {
                    EmptyView()
                }
                .labelsHidden()
                .frame(width: 84)
                .disabled(model.running || model.saving)
                .help("수집 브라우저")
                .onChange(of: settings.wrappedValue.browser) { _ in model.browserChanged(platform) }
            }

            if capability?.supportsAccountVerification != false {
                Button {
                    model.verifyAccount(platform)
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .buttonStyle(.borderless)
                .help("현재 로그인 계정 다시 확인")
                .disabled(model.running || model.saving || check?.status == .checking)
            }
        }

        if let check {
            accountStatusView(check, platform: platform)
        }
    }

    @ViewBuilder
    private func accountStatusIcon(_ check: AccountCheck?) -> some View {
        switch check?.status {
        case .verified:
            Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
        case .mismatch:
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
        case .loginRequired:
            Image(systemName: "person.crop.circle.badge.exclamationmark").foregroundStyle(.orange)
        case .failed:
            Image(systemName: "xmark.circle.fill").foregroundStyle(.red)
        default:
            EmptyView()
        }
    }

    @ViewBuilder
    private func accountStatusView(_ check: AccountCheck, platform: String) -> some View {
        switch check.status {
        case .checking:
            Text("계정을 확인하는 중입니다…").font(.caption).foregroundStyle(.secondary)
        case .verified:
            EmptyView()
        case .mismatch:
            HStack(alignment: .top, spacing: 8) {
                Text(check.message ?? "로그인 계정이 저장된 계정과 다릅니다.")
                    .font(.caption).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true)
                Spacer()
                Button("현재 계정으로 변경") { model.useDetectedAccount(platform) }
                    .controlSize(.small)
                    .disabled(model.saving || model.running)
            }
        case .loginRequired:
            Text("브라우저에서 로그인이 필요합니다.").font(.caption).foregroundStyle(.orange)
        case .failed:
            Text(check.message ?? "계정을 확인하지 못했습니다.").font(.caption).foregroundStyle(.red)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func surfaceChips(settings: Binding<PlatformSettings>, surfaces: [SurfaceCapability]) -> some View {
        HStack(spacing: 6) {
            ForEach(surfaces, id: \.key) { surface in
                surfaceChip(surface, settings: settings)
            }
            Spacer()
        }
    }

    private func surfaceChip(_ surface: SurfaceCapability, settings: Binding<PlatformSettings>) -> some View {
        let isOn = settings.wrappedValue.surfaces[surface.key] ?? false
        return Button {
            if surface.supported {
                settings.wrappedValue.surfaces[surface.key]?.toggle()
                model.update()
            } else {
                model.notice = surface.unavailableReason ?? "\(surface.label)는 사용할 수 없습니다."
            }
        } label: {
            HStack(spacing: 3) {
                Text(surface.label)
                if !surface.supported {
                    Image(systemName: "minus.circle")
                }
            }
            .font(.caption)
            .foregroundStyle(surface.supported && isOn ? Color.white : (surface.supported ? Color.primary : Color.secondary))
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(
                isOn
                    ? (surface.supported ? Color.accentColor : Color.secondary)
                    : Color.secondary.opacity(surface.supported ? 0.18 : 0.10)
            )
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(model.running || model.saving)
        .help(surface.supported ? surface.label : "\(surface.label): \(surface.unavailableReason ?? "사용할 수 없음")")
    }

    private func formattedDate(_ isoDate: String) -> String {
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = parser.date(from: isoDate) ?? ISO8601DateFormatter().date(from: isoDate) else { return isoDate }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ko_KR")
        formatter.dateFormat = Calendar.current.isDateInToday(date) ? "오늘 HH:mm" : "M월 d일 HH:mm"
        return formatter.string(from: date)
    }
}
