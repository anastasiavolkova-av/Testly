const { spawn } = require('child_process');
const path = require('path');

class StatsService {
    constructor() {
        this.scriptPath = path.resolve(__dirname, '../../statistical_analyzer.py');
        this.pythonBin = process.env.PYTHON_BIN || 'python3';
    }

    runExperimentAnalysis(experimentId) {
        return new Promise((resolve, reject) => {
            const safeId = Number(experimentId);
            if (!Number.isInteger(safeId) || safeId <= 0) {
                reject(new Error(`Некорректный experiment_id: ${experimentId}`));
                return;
            }

            const args = [this.scriptPath, '--experiment_id', String(safeId)];
            const child = spawn(this.pythonBin, args, {
                cwd: path.resolve(__dirname, '../..'),
                env: process.env
            });

            let stdout = '';
            let stderr = '';

            child.stdout.on('data', (chunk) => {
                stdout += chunk.toString();
            });

            child.stderr.on('data', (chunk) => {
                stderr += chunk.toString();
            });

            child.on('error', (error) => {
                reject(new Error(`Не удалось запустить анализатор: ${error.message}`));
            });

            child.on('close', (code) => {
                if (code === 0) {
                    resolve({ code, stdout, stderr });
                    return;
                }

                reject(new Error(
                    `Анализатор завершился с кодом ${code}.\n` +
                    `stdout:\n${stdout}\n` +
                    `stderr:\n${stderr}`
                ));
            });
        });
    }
}

module.exports = StatsService;
