class Butter < Formula
  desc "Lightweight desktop app framework with native webview and TypeScript"
  homepage "https://github.com/wess/butter"
  url "https://github.com/wess/butter/archive/refs/tags/v0.1.0.tar.gz"
  sha256 "UPDATE_WITH_ACTUAL_SHA256"
  license "MIT"

  depends_on "bun"

  def install
    # Install the package globally via Bun
    system "bun", "add", "-g", "butterframework@#{version}"
  end

  def caveats
    <<~EOS
      Butter requires Bun to be installed.

      Get started:
        butter init myapp
        cd myapp
        bun install
        bun run dev
    EOS
  end

  test do
    assert_match "butter", shell_output("#{bin}/butter help")
  end
end
