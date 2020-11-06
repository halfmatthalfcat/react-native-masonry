import differenceBy from 'lodash.differenceby';
import isEqual from 'lodash.isequal';
import PropTypes from 'prop-types';
import React, { Component } from 'react';
import { Dimensions, FlatList, View } from 'react-native';
import styles from '../styles/main';
import Column from './Column';

import { resolveImage } from './model';

// assignObjectColumn :: Number -> [Objects] -> [Objects]
export const assignObjectColumn = (nColumns, index, targetObject) => ({...targetObject, ...{ column: index % nColumns }});

// Assigns an `index` property` from bricks={data}` for later sorting.
// assignObjectIndex :: (Number, Object) -> Object
export const assignObjectIndex = (index, targetObject) => ({...targetObject, ...{ index }});

// findMinIndex :: [Numbers] -> Number
export const findMinIndex = (srcArray) => srcArray.reduce((shortest, cValue, cIndex, cArray) => (cValue < cArray[shortest]) ? cIndex : shortest, 0);

// containMatchingUris :: ([brick], [brick]) -> Bool
export const containMatchingUris = (r1, r2) => isEqual(r1.map(brick => brick.uri), r2.map(brick => brick.uri));

// Fills an array with 0's based on number count
// generateColumnsHeight :: Number -> Array [...0]
export const generateColumnHeights = count => Array(count).fill(0);

const INVALID_COLUMN_WIDTH = -1;
const PRIORITY_BALANCE = "balance";
const PRIORITY_ORDER = "order";

export default class Masonry extends Component {
	static propTypes = {
		bricks: PropTypes.array,
		columns: PropTypes.number,
		sorted: PropTypes.bool,
		imageContainerStyle: PropTypes.object,
		customImageComponent: PropTypes.func,
		customImageProps: PropTypes.object,
		spacing: PropTypes.number,
		priority: PropTypes.string,
		refreshControl: PropTypes.element,
		onEndReached: PropTypes.func,
		onEndReachedThreshold: PropTypes.number
	};

	static defaultProps = {
		bricks: [],
		columns: 2,
		sorted: false,
		imageContainerStyle: {},
		spacing: 1,
		priority: 'order',
		// no-op function
		onEndReached: () => ({}),
		onEndReachedThreshold: 25
	};

	constructor(props) {
		super(props);
		// This creates an array of [1..n] with values of 0, each index represent a column within the masonry
		const columnHeights = generateColumnHeights(props.columns);
		this.state = {
			data: [],
			dimensions: {},
			initialOrientation: true,
			_sortedData: [],
			_resolvedData: [],
			_columnHeights: columnHeights,
			_uniqueCount: props.bricks.length
		};
		// Assuming that rotation is binary (vertical|landscape)
		Dimensions.addEventListener('change', (window) => this.setState(state => ({ initialOrientation: !state.initialOrientation })));
	}

	componentDidMount() {
		// If balance priority isn't enabled, resolve bricks on didMount
		if (!this.isBalancingEnabled()) {
			this.resolveBricks(this.props);
		}
	}

	isBalancingEnabled() {
		const { priority } = this.props;
		return priority == PRIORITY_BALANCE;
	}

	componentWillReceiveProps(nextProps) {
		const differentColumns = this.props.columns !== nextProps.columns;
		const differentPriority = this.props.priority !== nextProps.priority;
		// We use the difference in the passed in bricks to determine if user is appending or not
		const brickDiff = differenceBy(nextProps.bricks, this.props.bricks, 'uri');
		const appendedData = brickDiff.length !== nextProps.bricks.length;
		const _uniqueCount = brickDiff.length + this.props.bricks.length;

		// These intents would entail a complete re-render of the listview
		if (differentColumns || differentPriority || !appendedData) {
			this.setState(state => ({
				_sortedData: [],
				_resolvedData: [],
				_columnHeights: generateColumnHeights(nextProps.columns),
				_uniqueCount
			}), this.resolveBricks(nextProps));
		}

		// We use the existing data and only resolve what is needed
		if (appendedData) {
			const offSet = this.props.bricks.length;
			this.setState({
				_uniqueCount
			}, this.resolveBricks({...nextProps, bricks: brickDiff}, offSet));
		}
	}

	getColumnWidth(width, spacing, columns) {
		const gutterBase = width / 100;
		const gutterSize = gutterBase * spacing;
		return (width / columns) - (gutterSize / 2);
	}

	resolveBricks({ bricks, columns, spacing, priority }, offSet = 0) {
		if (bricks.length === 0) {
			// clear and re-render
			this.setState({ data: [] });
		}

		// Calculate column width in case balance priority
		let columnWidth = INVALID_COLUMN_WIDTH;
		if (this.isBalancingEnabled()) {
			const { dimensions: { width } } = this.state;
			columnWidth = this.getColumnWidth(width, spacing, columns);
		}

		// Sort bricks and place them into their respectable columns
		// Issues arise if state changes occur in the midst of a resolve
		bricks
			.map((brick, index) => assignObjectColumn(columns, index, brick))
			.map((brick, index) => assignObjectIndex(offSet + index, brick))
			.map(brick => resolveImage(brick))
			.map(resolveTask => resolveTask.fork(
				(err) => console.warn('Image failed to load'),
				(resolvedBrick) => {
					this.setState(state => {
						const sortedData = this._insertIntoColumn(resolvedBrick, state._sortedData, state._columnHeights, columnWidth);
						return {
							data: sortedData,
							_sortedData: sortedData,
							_resolvedData: [...state._resolvedData, resolvedBrick]
						};
					});
				}));
	}

	_setParentDimensions(event) {
		// Currently height isn't being utilized, but will pass through for future features
		const {width, height} = event.nativeEvent.layout;

		this.setState({
			dimensions: {
				width,
				height
			}
		}, () => {
			// If balance priority is enabled, resolve bricks after onLayout
			if (this.isBalancingEnabled()) {
				this.resolveBricks(this.props);
			}
		});
	}

	// Use columnHeights from state object provided by setState
	_insertIntoColumn = (resolvedBrick, dataSet, _columnHeights, columnWidth) => {
		let dataCopy = dataSet.slice();
		const priority = this.props.priority;
		let columnIndex;

		switch (priority) {
		case PRIORITY_BALANCE:
			// Column width only valid in case priority is balance
			// Best effort to balance but sometimes state changes may have delays when performing calculation
			columnIndex = findMinIndex(_columnHeights);
			const heightsCopy = _columnHeights.slice();
			const newColumnHeights = heightsCopy[columnIndex] + (columnWidth * resolvedBrick.dimensions.height / resolvedBrick.dimensions.width);
			heightsCopy[columnIndex] = newColumnHeights;
			this.setState({
				_columnHeights: heightsCopy
			});
			break;
		case PRIORITY_ORDER:
		default:
			columnIndex = resolvedBrick.column;
			break;
		}

		const column = dataSet[columnIndex];
		const sorted = this.props.sorted;

		if (column) {
			// Append to existing "row"/"column"
			let bricks = [...column, resolvedBrick];
			if (sorted) {
				// Sort bricks according to the index of their original array position
				bricks = bricks.sort((a, b) => (a.index < b.index) ? -1 : 1);
			}
			dataCopy[columnIndex] = bricks;
		} else {
			// Pass it as a new "row" for the data source
			dataCopy = [...dataCopy, [resolvedBrick]];
		}

		return dataCopy;
	};

  _delayCallEndReach = () => {
		const sortedData = this.state._sortedData;
		const sortedLength = sortedData.reduce((acc, cv) => cv.length + acc, 0);
		// Limit the invokes to only when the masonry has
		// fully loaded all of the content to ensure user fully reaches the end
		if (sortedLength === this.state._uniqueCount) {
			this.props.onEndReached();
		}
	}

	render() {
		return (
		<View style={{flex: 1}} onLayout={(event) => this._setParentDimensions(event)}>
			<FlatList
				contentContainerStyle={styles.masonry__container}
				data={this.state.data}
				removeClippedSubviews={false}
				onEndReached={this._delayCallEndReach}
				onEndReachedThreshold={this.props.onEndReachedThreshold}
				renderItem={(data, index) => (
					<Column
						data={data.item}
						columns={this.props.columns}
						parentDimensions={this.state.dimensions}
						imageContainerStyle={this.props.imageContainerStyle}
						customImageComponent={this.props.customImageComponent}
						customImageProps={this.props.customImageProps}
						spacing={this.props.spacing}
						key={`RN-MASONRY-COLUMN-${index}`}
					/>
				)}
				refreshControl={this.props.refreshControl}
			/>
		</View>
		);
	}
};
