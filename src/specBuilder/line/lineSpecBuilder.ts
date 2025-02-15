/*
 * Copyright 2023 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
import {
	COLOR_SCALE,
	DEFAULT_COLOR_SCHEME,
	DEFAULT_METRIC,
	DEFAULT_TIME_DIMENSION,
	FILTERED_TABLE,
	INTERACTION_MODE,
	LINE_TYPE_SCALE,
	OPACITY_SCALE,
} from '@constants';
import { addTooltipData, addTooltipSignals, isHighlightedByGroup } from '@specBuilder/chartTooltip/chartTooltipUtils';
import { getHoverMarkNames, hasInteractiveChildren, hasPopover } from '@specBuilder/marks/markUtils';
import {
	getMetricRangeData,
	getMetricRangeGroupMarks,
	getMetricRangeSignals,
	getMetricRanges,
} from '@specBuilder/metricRange/metricRangeUtils';
import { getFacetsFromProps } from '@specBuilder/specUtils';
import { addTrendlineData, getTrendlineMarks, getTrendlineScales, setTrendlineSignals } from '@specBuilder/trendline';
import { sanitizeMarkChildren, toCamelCase } from '@utils';
import { produce } from 'immer';
import { Data, Mark, Scale, Signal, Spec } from 'vega';

import { ColorScheme, LineProps, LineSpecProps, MarkChildElement } from '../../types';
import { addTimeTransform, getFilteredTooltipData, getTableData } from '../data/dataUtils';
import { addContinuousDimensionScale, addFieldToFacetScaleDomain, addMetricScale } from '../scale/scaleSpecBuilder';
import { addHighlightedItemSignalEvents, addHighlightedSeriesSignalEvents } from '../signal/signalSpecBuilder';
import { getLineHighlightedData, getLineStaticPointData } from './lineDataUtils';
import { getLineHoverMarks, getLineMark } from './lineMarkUtils';
import { getLineStaticPoint } from './linePointUtils';
import { getInteractiveMarkName, getPopoverMarkName } from './lineUtils';

export const addLine = produce<Spec, [LineProps & { colorScheme?: ColorScheme; index?: number }]>(
	(
		spec,
		{
			children,
			color = { value: 'categorical-100' },
			colorScheme = DEFAULT_COLOR_SCHEME,
			dimension = DEFAULT_TIME_DIMENSION,
			index = 0,
			lineType = { value: 'solid' },
			metric = DEFAULT_METRIC,
			metricAxis,
			name,
			opacity = { value: 1 },
			scaleType = 'time',
			...props
		}
	) => {
		const sanitizedChildren = sanitizeMarkChildren(children);
		const lineName = toCamelCase(name || `line${index}`);
		// put props back together now that all defaults are set
		const lineProps: LineSpecProps = {
			children: sanitizedChildren,
			color,
			colorScheme,
			dimension,
			index,
			interactiveMarkName: getInteractiveMarkName(sanitizedChildren, lineName),
			lineType,
			markType: 'line',
			metric,
			metricAxis,
			name: lineName,
			opacity,
			popoverMarkName: getPopoverMarkName(sanitizedChildren, lineName),
			scaleType,
			...props,
		};
		lineProps.isHighlightedByGroup = isHighlightedByGroup(lineProps);

		spec.data = addData(spec.data ?? [], lineProps);
		spec.signals = addSignals(spec.signals ?? [], lineProps);
		spec.scales = setScales(spec.scales ?? [], lineProps);
		spec.marks = addLineMarks(spec.marks ?? [], lineProps);

		return spec;
	}
);

export const addData = produce<Data[], [LineSpecProps]>((data, props) => {
	const { dimension, scaleType, children, name, staticPoint, isSparkline, isMethodLast } = props;
	if (scaleType === 'time') {
		const tableData = getTableData(data);
		tableData.transform = addTimeTransform(tableData.transform ?? [], dimension);
	}
	if (hasInteractiveChildren(children)) {
		data.push(getLineHighlightedData(name, FILTERED_TABLE, hasPopover(children), isHighlightedByGroup(props)));
		data.push(getFilteredTooltipData(children));
	}
	if (staticPoint || isSparkline) data.push(getLineStaticPointData(name, staticPoint, FILTERED_TABLE, isSparkline, isMethodLast));
	addTrendlineData(data, props);
	addTooltipData(data, props, false);
	data.push(...getMetricRangeData(props));
});

export const addSignals = produce<Signal[], [LineSpecProps]>((signals, props) => {
	const { children, name } = props;
	setTrendlineSignals(signals, props);
	signals.push(...getMetricRangeSignals(props));

	if (!hasInteractiveChildren(children)) return;
	addHighlightedItemSignalEvents(signals, `${name}_voronoi`, 2);
	addHighlightedSeriesSignalEvents(signals, `${name}_voronoi`, 2);
	addHoverSignals(signals, props);
	addTooltipSignals(signals, props);
});

export const setScales = produce<Scale[], [LineSpecProps]>((scales, props) => {
	const { metric, metricAxis, dimension, color, lineType, opacity, padding, scaleType, children, name } = props;
	// add dimension scale
	addContinuousDimensionScale(scales, { scaleType, dimension, padding });
	// add color to the color domain
	addFieldToFacetScaleDomain(scales, COLOR_SCALE, color);
	// add lineType to the lineType domain
	addFieldToFacetScaleDomain(scales, LINE_TYPE_SCALE, lineType);
	// add opacity to the opacity domain
	addFieldToFacetScaleDomain(scales, OPACITY_SCALE, opacity);
	// find the linear scale and add our fields to it
	addMetricScale(scales, getMetricKeys(metric, children, name));
	// add linear scale with custom name
	if (metricAxis) {
		addMetricScale(scales, getMetricKeys(metric, children, name), 'y', metricAxis);
	}
	// add trendline scales
	scales.push(...getTrendlineScales(props));
	return scales;
});

// The order that marks are added is important since it determines the draw order.
export const addLineMarks = produce<Mark[], [LineSpecProps]>((marks, props) => {
	const { name, children, color, lineType, opacity, staticPoint, isSparkline } = props;

	const { facets } = getFacetsFromProps({ color, lineType, opacity });

	marks.push({
		name: `${name}_group`,
		type: 'group',
		from: {
			facet: {
				name: `${name}_facet`,
				data: FILTERED_TABLE,
				groupby: facets,
			},
		},
		marks: [getLineMark(props, `${name}_facet`)],
	});
	if (staticPoint || isSparkline) marks.push(getLineStaticPoint(props));
	marks.push(...getMetricRangeGroupMarks(props));
	if (hasInteractiveChildren(children)) {
		marks.push(...getLineHoverMarks(props, `${FILTERED_TABLE}ForTooltip`));
	}
	marks.push(...getTrendlineMarks(props));
});

const getMetricKeys = (lineMetric: string, lineChildren: MarkChildElement[], lineName: string) => {
	const metricKeys = [lineMetric];

	// metric range fields should be added if metric-axis will be scaled to fit
	const metricRanges = getMetricRanges(lineChildren, lineName);
	metricRanges.forEach((metricRange) => {
		if (metricRange.scaleAxisToFit) metricKeys.push(metricRange.metricStart, metricRange.metricEnd);
	});

	return metricKeys;
};

const addHoverSignals = (signals: Signal[], props: LineSpecProps) => {
	const { interactionMode, name } = props;
	if (interactionMode !== INTERACTION_MODE.ITEM) return;
	getHoverMarkNames(name).forEach((hoverMarkName) => {
		addHighlightedItemSignalEvents(signals, hoverMarkName, 1);
		addHighlightedSeriesSignalEvents(signals, hoverMarkName, 1);
	});
};
