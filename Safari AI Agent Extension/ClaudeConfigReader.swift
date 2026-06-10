import Foundation

struct ClaudeConfig {
    let apiKey: String
    let baseUrl: String
    let model: String
}

struct ClaudeConfigReader {
    static func read() -> ClaudeConfig? {
        let path = FileManager.default
            .homeDirectoryForCurrentUser
            .appendingPathComponent(".claude/settings.json")

        guard let data = try? Data(contentsOf: path),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let env = json["env"] as? [String: String],
              let apiKey = env["ANTHROPIC_AUTH_TOKEN"],
              !apiKey.isEmpty
        else { return nil }

        return ClaudeConfig(
            apiKey: apiKey,
            baseUrl: env["ANTHROPIC_BASE_URL"] ?? "https://api.anthropic.com/v1/messages",
            model: env["ANTHROPIC_MODEL"] ?? "claude-sonnet-latest"
        )
    }
}
