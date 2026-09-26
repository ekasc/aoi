/**
 * Adopts the iOS scene lifecycle, which the iOS 26+ SDK requires.
 *
 * Without a scene manifest the app dies at launch on current iOS
 * (`___UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`), and
 * once scenes are adopted the AppDelegate-owned window is ignored — so the
 * scene owns the window and boots React Native into it. The AppDelegate gate
 * below keeps the old window path for runtimes without scenes and prevents a
 * second, invisible bridge where scenes are adopted.
 *
 * Everything here is assert-anchored: if a future Expo template moves the
 * AppDelegate boot block, prebuild fails loudly instead of silently
 * double-booting or black-screening.
 */
const fs = require('fs');
const path = require('path');
const {
  withDangerousMod,
  withInfoPlist,
  withXcodeProject,
} = require('@expo/config-plugins');

const SCENE_DELEGATE_SWIFT = `internal import Expo
import React
import ReactAppDependencyProvider

// Adopted for the iOS 26+ SDK (see plugins/with-ios-scene-delegate): the
// scene owns the window and boots React Native into it, because an
// AppDelegate-owned window is ignored once scenes are in play. AppDelegate
// keeps the windowless path for runtimes without scenes.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene else {
      return
    }
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    let window = UIWindow(windowScene: windowScene)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: nil)
    self.window = window
    window.makeKeyAndVisible()
  }

  // Custom URL schemes arrive on the scene once scenes are adopted. They go
  // through the shared delegate so every Expo module (dev launcher, linking)
  // sees them, exactly as if scenes were off.
  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    guard let appDelegate = UIApplication.shared.delegate else {
      return
    }
    for context in URLContexts {
      _ = appDelegate.application?(UIApplication.shared, open: context.url, options: [:])
    }
  }
}
`;

// The Expo template's AppDelegate boot block, verbatim. The gate wraps it so
// scene runtimes boot exactly once, from SceneDelegate.
const APP_DELEGATE_BOOT_BLOCK = `#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif`;

const APP_DELEGATE_BOOT_GATED = `#if os(iOS) || os(tvOS)
    // With a scene manifest the scene owns the window (see SceneDelegate)
    // and this window would boot a second, invisible bridge. Only take the
    // windowless path on runtimes without scenes.
    if Bundle.main.object(forInfoDictionaryKey: "UIApplicationSceneManifest") == nil {
      window = UIWindow(frame: UIScreen.main.bounds)
      factory.startReactNative(
        withModuleName: "main",
        in: window,
        launchOptions: launchOptions)
    }
#endif`;

function withSceneManifest(config) {
  return withInfoPlist(config, (config) => {
    config.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
          },
        ],
      },
    };
    return config;
  });
}

function withSceneDelegateSources(config) {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const projectRoot = config.modRequest.platformProjectRoot;
      fs.writeFileSync(
        path.join(projectRoot, 'aoi', 'SceneDelegate.swift'),
        SCENE_DELEGATE_SWIFT
      );

      const appDelegatePath = path.join(projectRoot, 'aoi', 'AppDelegate.swift');
      const appDelegate = fs.readFileSync(appDelegatePath, 'utf8');
      if (appDelegate.includes('SceneDelegate')) {
        // Already gated (a previous prebuild applied this mod).
        return config;
      }
      if (!appDelegate.includes(APP_DELEGATE_BOOT_BLOCK)) {
        throw new Error(
          '[with-ios-scene-delegate] AppDelegate.swift boot block moved; update APP_DELEGATE_BOOT_BLOCK.'
        );
      }
      fs.writeFileSync(
        appDelegatePath,
        appDelegate.replace(APP_DELEGATE_BOOT_BLOCK, APP_DELEGATE_BOOT_GATED)
      );
      return config;
    },
  ]);
}

function withSceneDelegateTarget(config) {
  return withXcodeProject(config, (config) => {
    const xcodeProject = config.modResults;
    if (xcodeProject.hasFile('aoi/SceneDelegate.swift')) {
      return config;
    }
    const targetUuid = xcodeProject.getFirstTarget().uuid;
    const groupKey = xcodeProject.findPBXGroupKey({ name: 'aoi' });
    if (!groupKey) {
      throw new Error(
        '[with-ios-scene-delegate] PBXGroup named "aoi" not found; cannot add SceneDelegate.swift.'
      );
    }
    // The aoi group is pathless, so members carry the aoi/ prefix exactly
    // like the template's own AppDelegate.swift reference.
    const added = xcodeProject.addSourceFile(
      'aoi/SceneDelegate.swift',
      { target: targetUuid, lastKnownFileType: 'sourcecode.swift' },
      groupKey
    );
    if (!added) {
      throw new Error(
        '[with-ios-scene-delegate] addSourceFile refused SceneDelegate.swift.'
      );
    }
    return config;
  });
}

module.exports = function withIosSceneDelegate(config) {
  config = withSceneManifest(config);
  config = withSceneDelegateSources(config);
  config = withSceneDelegateTarget(config);
  return config;
};
