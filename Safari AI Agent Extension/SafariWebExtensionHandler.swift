import SafariServices
import os.log

class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {

    func beginRequest(with context: NSExtensionContext) {
        let request = context.inputItems.first as? NSExtensionItem

        let profile: UUID?
        if #available(iOS 17.0, macOS 14.0, *) {
            profile = request?.userInfo?[SFExtensionProfileKey] as? UUID
        } else {
            profile = request?.userInfo?["profile"] as? UUID
        }

        let message: Any?
        if #available(iOS 15.0, macOS 11.0, *) {
            message = request?.userInfo?[SFExtensionMessageKey]
        } else {
            message = request?.userInfo?["message"]
        }

        os_log(.default, "Received message from browser.runtime.sendMessage: %@ (profile: %@)", String(describing: message), profile?.uuidString ?? "none")

        let responsePayload: [String: Any]

        if let dict = message as? [String: Any],
           let type = dict["type"] as? String,
           type == "getAIConfig" {
            if let config = ClaudeConfigReader.read() {
                responsePayload = [
                    "apiKey":  config.apiKey,
                    "baseUrl": config.baseURL,
                    "model":   config.model,
                    "source":  "claude-config"
                ]
            } else {
                responsePayload = [
                    "apiKey":  "",
                    "baseUrl": "https://api.anthropic.com/v1/messages",
                    "model":   "claude-sonnet-latest",
                    "source":  "not-found"
                ]
            }
        } else {
            responsePayload = ["echo": message as Any]
        }

        let response = NSExtensionItem()
        if #available(iOS 15.0, macOS 11.0, *) {
            response.userInfo = [SFExtensionMessageKey: responsePayload]
        } else {
            response.userInfo = ["message": responsePayload]
        }

        context.completeRequest(returningItems: [response], completionHandler: nil)
    }

}
