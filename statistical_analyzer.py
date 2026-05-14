import math
import psycopg2
from statsmodels.stats.proportion import proportions_ztest, proportion_effectsize
from statsmodels.stats.power import NormalIndPower, TTestIndPower
from scipy import stats
import os
from dotenv import load_dotenv

load_dotenv()

# Параметры подключения к БД 
DB_CONFIG = {
    'host': os.getenv('DB_HOST', 'localhost'),
    'port': int(os.getenv('DB_PORT', 5432)),
    'dbname': os.getenv('DB_NAME', 'ux_ab_testing'),
    'user': os.getenv('DB_USER', 'postgres'),
    'password': os.getenv('DB_PASSWORD', 'postgres'),
}


class StatisticalAnalyzer:
    """Класс для расчёта статистической значимости метрик A/B-экспериментов."""

    def __init__(self):
        # Подключение к PostgreSQL по DB_CONFIG
        self.conn = psycopg2.connect(**DB_CONFIG)
        self.alpha = 0.05
        self.ci_level = 0.95
        self.target_power = 0.8

    def get_raw_data(self, experiment_id, metric_id):
        """Возвращает сырые данные по выбранной метрике и эксперименту из БД (по одной выборке на группу A и B)."""
        cur = self.conn.cursor()

        # Подсчёт метрики: form_completion_rate (metric_id=5) — доля сессий с отправкой формы среди сессий с фокусом на форме
        if metric_id == 5:
            cur.execute("""
                WITH form_starts AS (
                    SELECT DISTINCT s.session_id, s.ab_group
                    FROM sessions s
                    JOIN events e ON s.session_id = e.session_id
                    WHERE s.experiment_id = %s AND e.event_name = 'form_focus'
                ),
                form_submits AS (
                    SELECT DISTINCT s.session_id, s.ab_group
                    FROM sessions s
                    JOIN events e ON s.session_id = e.session_id
                    WHERE s.experiment_id = %s AND e.event_name = 'form_submit'
                )
                SELECT
                    fs.ab_group,
                    CASE WHEN fsub.session_id IS NOT NULL THEN 1 ELSE 0 END AS value
                FROM form_starts fs
                LEFT JOIN form_submits fsub ON fs.session_id = fsub.session_id AND fs.ab_group = fsub.ab_group
            """, [experiment_id, experiment_id])

        # Подсчёт метрики: avg_session_duration (metric_id=2) — длительность сессии в секундах
        elif metric_id == 2:
            cur.execute("""
                SELECT ab_group, duration_ms / 1000.0 as value
                FROM sessions
                WHERE experiment_id = %s AND duration_ms IS NOT NULL
            """, [experiment_id])

        # Подсчёт метрики: avg_scroll_depth (metric_id=1) — максимальная глубина скролла по сессии
        elif metric_id == 1:
            cur.execute("""
                SELECT ab_group, max_scroll_depth as value
                FROM sessions
                WHERE experiment_id = %s AND max_scroll_depth IS NOT NULL
            """, [experiment_id])

        # Подсчёт метрики: bounce_rate (metric_id=3) — доля сессий с не более чем двумя событиями
        elif metric_id == 3:
            cur.execute("""
                WITH session_counts AS (
                    SELECT 
                        s.session_id,
                        s.ab_group,
                        COUNT(e.event_id) as event_count,
                        CASE WHEN COUNT(e.event_id) <= 2 THEN 1 ELSE 0 END as is_bounce
                    FROM sessions s
                    LEFT JOIN events e ON s.session_id = e.session_id
                    WHERE s.experiment_id = %s
                    GROUP BY s.session_id, s.ab_group
                )
                SELECT ab_group, is_bounce as value FROM session_counts
            """, [experiment_id])

        # Подсчёт метрики: event_density_avg (metric_id=4) — среднее число событий в секунду по сессии
        elif metric_id == 4:
            cur.execute("""
                SELECT 
                    s.ab_group,
                    COUNT(e.event_id)::float / (s.duration_ms / 1000.0) as value
                FROM sessions s
                JOIN events e ON s.session_id = e.session_id
                WHERE s.experiment_id = %s AND s.duration_ms > 0
                GROUP BY s.session_id, s.ab_group, s.duration_ms
            """, [experiment_id])

        # Подсчёт метрики: avg_task_time_sec (metric_id=6) — время от первого form_focus до первого form_submit по сессии
        elif metric_id == 6:
            cur.execute("""
                WITH first_focus AS (
                    SELECT s.session_id, s.ab_group, MIN(e.timestamp) AS focus_time
                    FROM sessions s
                    JOIN events e ON s.session_id = e.session_id
                    WHERE s.experiment_id = %s AND e.event_name = 'form_focus'
                    GROUP BY s.session_id, s.ab_group
                ),
                first_submit AS (
                    SELECT s.session_id, s.ab_group, MIN(e.timestamp) AS submit_time
                    FROM sessions s
                    JOIN events e ON s.session_id = e.session_id
                    WHERE s.experiment_id = %s AND e.event_name = 'form_submit'
                    GROUP BY s.session_id, s.ab_group
                )
                SELECT
                    ff.ab_group,
                    EXTRACT(EPOCH FROM (fs.submit_time - ff.focus_time))::float AS value
                FROM first_focus ff
                JOIN first_submit fs ON ff.session_id = fs.session_id AND ff.ab_group = fs.ab_group
            """, [experiment_id, experiment_id])

        # Подсчёт метрики: confusion_index (metric_id=7) — доля кликов по неинтерактивным элементам
        elif metric_id == 7:
            cur.execute("""
                SELECT 
                    s.ab_group,
                    CASE 
                        WHEN e.event_data->'element'->>'tag' IN ('p', 'div', 'span', 'h1', 'h2', 'h3', 'section', 'article')
                        AND (e.event_data->'element'->>'role' IS NULL OR e.event_data->'element'->>'role' NOT IN ('button', 'link'))
                        THEN 1 ELSE 0 
                    END AS value
                FROM events e
                JOIN sessions s ON e.session_id = s.session_id
                WHERE s.experiment_id = %s AND e.event_name = 'click'
            """, [experiment_id])

        # Подсчёт метрики: error_rate (metric_id=8) — доля ошибок среди взаимодействий (знаменатель — только click, form_focus, form_submit)
        elif metric_id == 8:
            cur.execute("""
                WITH by_group AS (
                    SELECT
                        s.ab_group,
                        COUNT(*) FILTER (WHERE e.event_name IN ('js_error', 'promise_error', 'resource_error')) AS errors,
                        COUNT(*) FILTER (WHERE e.event_name IN ('click', 'form_focus', 'form_submit')) AS interactions
                    FROM events e
                    JOIN sessions s ON e.session_id = s.session_id
                    WHERE s.experiment_id = %s
                    GROUP BY s.ab_group
                )
                SELECT ab_group, errors, interactions FROM by_group
            """, [experiment_id])
            rows = cur.fetchall()
            cur.close()
            # Для z-теста пропорций возвращаем пары (число успехов, объём выборки) по группам A и B
            counts = {r[0]: (r[1], r[2]) for r in rows}
            s_a, n_a = counts.get('A', (0, 0))
            s_b, n_b = counts.get('B', (0, 0))
            return (s_a, n_a), (s_b, n_b)
        
        rows = cur.fetchall()
        cur.close()

        # Разбиение строк результата на выборки по группам A и B
        data_a = [r[1] for r in rows if r[0] == 'A']
        data_b = [r[1] for r in rows if r[0] == 'B']

        return data_a, data_b

    def is_binary_metric(self, metric_id):
        """Определяет, является ли метрика бинарной (доля): bounce_rate, form_completion_rate, confusion_index, error_rate."""
        binary_metrics = [3, 5, 7, 8]
        return metric_id in binary_metrics

    def _calculate_binary_statistics(self, success_a, n_a, success_b, n_b):
        """Считает статистику для бинарных метрик: p-value, CI разницы долей, мощность и required_n."""
        n_a = int(n_a)
        n_b = int(n_b)
        success_a = int(success_a)
        success_b = int(success_b)
        result = {
            "p_value": 1.0,
            "ci_lower": None,
            "ci_upper": None,
            "ci_level": self.ci_level,
            "power": None,
            "required_n": None
        }

        if n_a == 0 or n_b == 0:
            return result

        p_a = success_a / n_a
        p_b = success_b / n_b
        diff = p_b - p_a

        # Z-тест для двух пропорций
        if (success_a == 0 and success_b == 0) or (success_a == n_a and success_b == n_b):
            p_value = 1.0
        else:
            _, p_value = proportions_ztest(count=[success_a, success_b], nobs=[n_a, n_b])
            if math.isnan(float(p_value)):
                p_value = 1.0
        result["p_value"] = float(p_value)

        # 95% CI для разницы долей (normal approximation, B - A)
        z_crit = stats.norm.ppf(1 - self.alpha / 2)
        se = math.sqrt((p_a * (1 - p_a) / n_a) + (p_b * (1 - p_b) / n_b))
        if se == 0:
            ci_lower = diff
            ci_upper = diff
        else:
            margin = z_crit * se
            ci_lower = diff - margin
            ci_upper = diff + margin
        result["ci_lower"] = float(ci_lower)
        result["ci_upper"] = float(ci_upper)

        # Мощность и required_n через эффект Cohen's h
        effect_size = abs(proportion_effectsize(p_a, p_b))
        if effect_size > 0:
            power_analysis = NormalIndPower()
            ratio = n_b / n_a if n_a > 0 else 1.0
            try:
                achieved_power = power_analysis.solve_power(
                    effect_size=effect_size,
                    nobs1=n_a,
                    alpha=self.alpha,
                    ratio=ratio,
                    alternative='two-sided'
                )
                result["power"] = float(achieved_power)
            except Exception:
                result["power"] = None

            try:
                required_n = power_analysis.solve_power(
                    effect_size=effect_size,
                    alpha=self.alpha,
                    power=self.target_power,
                    ratio=1.0,
                    alternative='two-sided'
                )
                result["required_n"] = int(math.ceil(required_n))
            except Exception:
                result["required_n"] = None

        return result

    def _calculate_continuous_statistics(self, data_a, data_b):
        """Считает статистику для количественных метрик: Welch p-value, CI разницы средних, мощность и required_n."""
        data_a = [float(x) for x in data_a]
        data_b = [float(x) for x in data_b]
        n_a = len(data_a)
        n_b = len(data_b)
        result = {
            "p_value": 1.0,
            "ci_lower": None,
            "ci_upper": None,
            "ci_level": self.ci_level,
            "power": None,
            "required_n": None
        }

        if n_a < 2 or n_b < 2:
            return result

        mean_a = sum(data_a) / n_a
        mean_b = sum(data_b) / n_b
        diff = mean_b - mean_a
        var_a = sum((x - mean_a) ** 2 for x in data_a) / (n_a - 1)
        var_b = sum((x - mean_b) ** 2 for x in data_b) / (n_b - 1)

        # Welch t-test
        _, p_value = stats.ttest_ind(data_a, data_b, equal_var=False)
        if math.isnan(float(p_value)):
            p_value = 1.0
        result["p_value"] = float(p_value)

        # 95% CI для разницы средних (Welch-Satterthwaite)
        se = math.sqrt((var_a / n_a) + (var_b / n_b))
        denom = ((var_a / n_a) ** 2) / (n_a - 1) + ((var_b / n_b) ** 2) / (n_b - 1)
        if se == 0 or denom == 0:
            ci_lower = diff
            ci_upper = diff
        else:
            df = ((var_a / n_a) + (var_b / n_b)) ** 2 / denom
            t_crit = stats.t.ppf(1 - self.alpha / 2, df)
            margin = t_crit * se
            ci_lower = diff - margin
            ci_upper = diff + margin
        result["ci_lower"] = float(ci_lower)
        result["ci_upper"] = float(ci_upper)

        # Мощность и required_n через эффект Cohen's d
        pooled_denom = n_a + n_b - 2
        if pooled_denom > 0:
            pooled_var = (((n_a - 1) * var_a) + ((n_b - 1) * var_b)) / pooled_denom
            if pooled_var > 0:
                effect_size = abs(diff / math.sqrt(pooled_var))
                if effect_size > 0:
                    power_analysis = TTestIndPower()
                    ratio = n_b / n_a if n_a > 0 else 1.0
                    try:
                        achieved_power = power_analysis.solve_power(
                            effect_size=effect_size,
                            nobs1=n_a,
                            alpha=self.alpha,
                            ratio=ratio,
                            alternative='two-sided'
                        )
                        result["power"] = float(achieved_power)
                    except Exception:
                        result["power"] = None

                    try:
                        required_n = power_analysis.solve_power(
                            effect_size=effect_size,
                            alpha=self.alpha,
                            power=self.target_power,
                            ratio=1.0,
                            alternative='two-sided'
                        )
                        result["required_n"] = int(math.ceil(required_n))
                    except Exception:
                        result["required_n"] = None

        return result

    def calculate_statistics(self, data_a, data_b, metric_id):
        """Вычисляет p-value, CI, мощность и required_n для метрики."""
        if self.is_binary_metric(metric_id):
            return self._calculate_binary_statistics(
                success_a=int(sum(data_a)),
                n_a=len(data_a),
                success_b=int(sum(data_b)),
                n_b=len(data_b)
            )
        return self._calculate_continuous_statistics(data_a, data_b)

    def save_result(self, experiment_id, metric_id, stats_result):
        """Записывает статистику в statistical_results с upsert."""
        p_value = float(stats_result["p_value"])
        cur = self.conn.cursor()
        cur.execute("""
            INSERT INTO statistical_results (
                experiment_id,
                metric_id,
                p_value,
                ci_lower,
                ci_upper,
                ci_level,
                power,
                required_n,
                calculated_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW())
            ON CONFLICT (experiment_id, metric_id) 
            DO UPDATE SET
                p_value = EXCLUDED.p_value,
                ci_lower = EXCLUDED.ci_lower,
                ci_upper = EXCLUDED.ci_upper,
                ci_level = EXCLUDED.ci_level,
                power = EXCLUDED.power,
                required_n = EXCLUDED.required_n,
                calculated_at = NOW()
        """, [
            experiment_id,
            metric_id,
            p_value,
            stats_result["ci_lower"],
            stats_result["ci_upper"],
            stats_result["ci_level"],
            stats_result["power"],
            stats_result["required_n"]
        ])
        self.conn.commit()
        cur.close()
    
    def analyze_experiment(self, experiment_id):
        """Запускает расчёт p-value по всем метрикам эксперимента и сохраняет результаты в БД."""
        print(f"\nАнализ эксперимента #{experiment_id}")
        print("=" * 50)

        # Список метрик, для которых уже есть агрегаты в experiment_results
        cur = self.conn.cursor()
        cur.execute("""
            SELECT DISTINCT metric_id 
            FROM experiment_results 
            WHERE experiment_id = %s
        """, [experiment_id])
        
        metrics = cur.fetchall()
        cur.close()
        
        for (metric_id,) in metrics:
            print(f"\nМетрика #{metric_id}:")

            raw = self.get_raw_data(experiment_id, metric_id)

            # Метрика 8 возвращает пары (число ошибок, число взаимодействий) по группам
            if metric_id == 8:
                (s_a, n_a), (s_b, n_b) = raw
                s_a, n_a, s_b, n_b = int(s_a), int(n_a), int(s_b), int(n_b)
                print(f"  Группа A: {s_a} ошибок из {n_a} взаимодействий.")
                print(f"  Группа B: {s_b} ошибок из {n_b} взаимодействий.")
                if n_a == 0 or n_b == 0:
                    print("  Пропуск: нет взаимодействий в одной из групп.")
                    continue
                stats_result = self._calculate_binary_statistics(s_a, n_a, s_b, n_b)
                print("  Метод: z-тест для пропорций (error_rate).")
            else:
                data_a, data_b = raw
                print(f"  Группа A: {len(data_a)} записей.")
                print(f"  Группа B: {len(data_b)} записей.")
                if len(data_a) == 0 or len(data_b) == 0:
                    print("  Пропуск: нет данных в одной из групп.")
                    continue
                stats_result = self.calculate_statistics(data_a, data_b, metric_id)
                if self.is_binary_metric(metric_id):
                    print("  Метод: z-тест для пропорций (бинарные данные).")
                else:
                    print("  Метод: t-тест Welch (количественные данные).")

            print(f"  p-value = {stats_result['p_value']:.4f}")
            if stats_result["ci_lower"] is not None and stats_result["ci_upper"] is not None:
                print(f"  95% CI (B - A): [{stats_result['ci_lower']:.4f}, {stats_result['ci_upper']:.4f}]")
            if stats_result["power"] is not None:
                print(f"  Мощность: {stats_result['power']:.4f}")
            if stats_result["required_n"] is not None:
                print(f"  Требуемый N на группу (power=0.8): {stats_result['required_n']}")

            self.save_result(experiment_id, metric_id, stats_result)

        print("\nАнализ завершён.")

    def close(self):
        """Закрывает соединение с БД."""
        self.conn.close()


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser()
    parser.add_argument('--experiment_id', type=int, required=True)
    args = parser.parse_args()
    
    analyzer = StatisticalAnalyzer()
    try:
        analyzer.analyze_experiment(args.experiment_id)
    finally:
        analyzer.close()