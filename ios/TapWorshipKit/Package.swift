// swift-tools-version:5.9
import PackageDescription

// TapWorshipKit — everything the iOS app needs that is NOT a view.
//
// Deliberately a plain SwiftPM library with no Apple-UI dependency, for two
// reasons: it can be compiled and exercised without Xcode (see Checks below),
// and it keeps the parts that must agree with the web app — the API shapes and
// the scheduling rules — in one place that a view can't quietly reach into.
let package = Package(
  name: "TapWorshipKit",
  platforms: [.iOS(.v17), .macOS(.v14)],
  products: [
    .library(name: "TapWorshipKit", targets: ["TapWorshipKit"]),
  ],
  targets: [
    .target(name: "TapWorshipKit"),
    // The test suite, as an EXECUTABLE rather than a .testTarget.
    //
    // XCTest ships with Xcode, not with the Command Line Tools, so on a
    // machine without full Xcode `swift test` cannot run at all — which is the
    // machine this port is being written on. An executable that asserts and
    // exits non-zero runs anywhere `swift` does, so the logic port is verified
    // from the first commit instead of on trust. In Xcode these become real
    // XCTest cases; `check()` below is a one-for-one stand-in for XCTAssert.
    .executableTarget(name: "Checks", dependencies: ["TapWorshipKit"]),
  ]
)
