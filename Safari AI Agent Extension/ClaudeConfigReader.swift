import Foundation

struct ClaudeConfig {
    let apiKey: String
    let baseURL: String
    let model: String
}

struct ClaudeConfigReader {
    static func read() -> ClaudeConfig? {
        let path = URL(fileURLWithPath: NSHomeDirectory())
            .appendingPathComponent(".claude/settings.json")

        guard let data = try? Data(contentsOf: path),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let env = json["env"] as? [String: Any],
              let apiKey = env["ANTHROPIC_AUTH_TOKEN"] as? String,
              !apiKey.isEmpty
        else { return nil }

        return ClaudeConfig(
            apiKey: apiKey,
            baseURL: env["ANTHROPIC_BASE_URL"] as? String ?? "https://api.anthropic.com/v1/messages",
            model: env["ANTHROPIC_MODEL"] as? String ?? "claude-sonnet-latest"
        )
    }
}
