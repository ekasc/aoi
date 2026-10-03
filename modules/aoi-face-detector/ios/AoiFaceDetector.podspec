Pod::Spec.new do |s|
  s.name = 'AoiFaceDetector'
  s.version = '0.1.0'
  s.summary = 'Local still-photo face detection for Aoi'
  s.description = s.summary
  s.license = { :type => 'UNLICENSED' }
  s.author = 'Aoi'
  s.homepage = 'https://expo.dev'
  s.source = { :path => '.' }
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'Vision', 'ImageIO', 'CoreGraphics', 'CryptoKit'
  s.source_files = '**/*.swift'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
