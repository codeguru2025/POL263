const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

module.exports = function withGradleWrapper(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const wrapperPath = path.join(
        config.modRequest.projectRoot,
        'android/gradle/wrapper/gradle-wrapper.properties'
      );

      if (fs.existsSync(wrapperPath)) {
        let content = fs.readFileSync(wrapperPath, 'utf-8');
        content = content.replace(
          /distributionUrl=https\\:\/\/services\.gradle\.org\/distributions\/gradle-.*-bin\.zip/,
          'distributionUrl=https\\://services.gradle.org/distributions/gradle-8.13-bin.zip'
        );
        fs.writeFileSync(wrapperPath, content);
        console.log('[withGradleWrapper] Pinned Gradle wrapper to 8.13');
      }

      return config;
    },
  ]);
};
