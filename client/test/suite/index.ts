import * as path from "path";
import Mocha from "mocha";

export function run(): Promise<void> {
  const mocha = new Mocha({ ui: "tdd", color: true, timeout: 20000 });
  const testsRoot = path.resolve(__dirname);

  return new Promise((resolve, reject) => {
    try {
      mocha.addFile(path.resolve(testsRoot, "extension.test.js"));
      mocha.run((failures) => {
        if (failures > 0) {
          reject(new Error(`${failures} test(s) failed.`));
        } else {
          resolve();
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}
