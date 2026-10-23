# Known issues

## iOS 26 standalone: 下端が少し引っ張れる（未修正）

- 2026-10-22
- `body` を `100dvh` の1行グリッドにし、`overflow: hidden` / `overscroll-behavior: none` にしても、iOS 26 のホーム画面アプリでは下端で小さなラバーバンドが残る。
- iOS 26 の standalone WebView は画面（844px）よりステータスバー分（47px）短く、下に未描画の帯がある。DSH側のスクロールは本文1つにしたが、このネイティブの引っ張りはCSSでは止めきれない。
- 恒久対応は iOS/WebKit の修正、またはネイティブラッパー（Capacitor など）。
- 参考: [WebKit Bug 301994](https://bugs.webkit.org/show_bug.cgi?id=301994)
