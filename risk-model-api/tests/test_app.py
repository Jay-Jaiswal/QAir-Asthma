import unittest
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app


class FakeModel:
    feature_names_in_ = np.array(app.FEATURE_NAMES)
    classes_ = np.array([1, 0])

    def predict(self, values):
        return np.array([1])

    def predict_proba(self, values):
        return np.array([[0.84, 0.16]])


class ModelApiTests(unittest.TestCase):
    def setUp(self):
        self.original_model = app._model
        app._model = FakeModel()

    def tearDown(self):
        app._model = self.original_model

    def test_probability_is_selected_by_class(self):
        result = app.predict(
            app.ModelFeatures(
                pm2_5_24h_mean=60.2,
                nitrogen_dioxide_24h_mean=16.54,
                ozone_8h_max=129.5,
            )
        )
        self.assertEqual(result.prediction, 1)
        self.assertEqual(result.risk_probability, 0.84)
        self.assertEqual(result.risk_level, "high")

    def test_probability_thresholds(self):
        self.assertEqual(app.risk_level(0.49), "low")
        self.assertEqual(app.risk_level(0.5), "medium")
        self.assertEqual(app.risk_level(0.8), "high")


if __name__ == "__main__":
    unittest.main()
